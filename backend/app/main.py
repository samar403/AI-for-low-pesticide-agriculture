"""Patchwork API: precision-spraying platform (drone imagery + sensors -> AI hotspots -> spot-spray plan)."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .detector import detect, evaluate_field, get_model
from .prescription import PRODUCTS, PrescriptionParams, build_prescription, plan_mission, prescription_csv, prescription_geojson
from .simulator import (
    CLASSES,
    DEFAULT_SEASON_DAY,
    FIELDS,
    FIELDS_BY_ID,
    METRICS,
    season_date,
    sensor_history,
    simulate_survey,
    stations,
)
from .store import Store
from .vision_rgb import analyze_image, sample_image

@asynccontextmanager
async def lifespan(_: FastAPI):
    get_model()  # train the detector once at boot (~2-5 s) so the first request is fast
    yield


app = FastAPI(
    lifespan=lifespan,
    title="Patchwork API",
    version=__version__,
    description="Drones and sensors find the problem; AI decides where to spray; the drone sprays only there.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("PATCHWORK_CORS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def store() -> Store:
    return Store()


def _field(field_id: str):
    f = FIELDS_BY_ID.get(field_id)
    if not f:
        raise HTTPException(404, f"Unknown field '{field_id}'")
    return f


def _grid(a: np.ndarray, nd: int = 3) -> list:
    return np.round(a.astype(float), nd).tolist()


DayQ = Query(DEFAULT_SEASON_DAY, ge=5, le=90, description="Season day (0 = season start)")


# --------------------------------------------------------------------------- #
# Farm and fields
# --------------------------------------------------------------------------- #
def _field_card(f, day: int) -> dict:
    s = simulate_survey(f.id, day)
    det = _detect(f.id, day)
    rx = build_prescription(det)
    counts = {c: 0 for c in CLASSES[1:]}
    for h in det.hotspots:
        counts[h["class"]] += 1
    return {
        "id": f.id,
        "name": f.name,
        "crop": f.crop,
        "variety": f.variety,
        "area_ha": round(float(s.cropped.sum() * f.grid.cell_area_ha), 2),
        "centroid": dict(zip(("lat", "lon"), f.grid.cell_center_latlon(f.rows / 2 - 0.5, f.cols / 2 - 0.5))),
        "mean_ndvi": round(float(s.ndvi[s.cropped].mean()), 3),
        "hotspots": counts,
        "hotspot_total": len(det.hotspots),
        "treated_fraction": rx.summary["treated_fraction"],
        "chemical_reduction_pct": rx.summary["chemical_reduction_pct"],
        "cost_saving": rx.summary["cost_saving"],
        "last_survey": s.captured_at,
    }


def _detect(field_id: str, day: int, fuse: bool = True):
    return detect(field_id, day, fuse_sensors=fuse, trap_overrides=store().latest_trap_means(field_id))


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/farm")
def farm(day: int = DayQ) -> dict:
    cards = [_field_card(f, day) for f in FIELDS]
    rxs = [build_prescription(_detect(f.id, day)).summary for f in FIELDS]
    tot = lambda k: round(sum(r[k] for r in rxs), 2)  # noqa: E731
    bvol = tot("blanket_volume_l")
    return {
        "name": "Mesa Verde Farms",
        "region": "San Joaquin Valley, CA (simulated)",
        "season_day": day,
        "date": season_date(day).isoformat(),
        "fields": cards,
        "totals": {
            "cropped_ha": tot("cropped_ha"),
            "treated_ha": tot("treated_ha"),
            "volume_l": tot("volume_l"),
            "blanket_volume_l": bvol,
            "chemical_reduction_pct": round(100 * (1 - tot("volume_l") / bvol), 1) if bvol else 0.0,
            "cost": tot("cost"),
            "blanket_cost": tot("blanket_cost"),
            "cost_saving": tot("cost_saving"),
            "eiq_load": tot("eiq_load"),
            "blanket_eiq_load": tot("blanket_eiq_load"),
            "hotspots": sum(c["hotspot_total"] for c in cards),
        },
    }


@app.get("/api/fields")
def list_fields(day: int = DayQ) -> list[dict]:
    return [_field_card(f, day) for f in FIELDS]


@app.get("/api/fields/{field_id}")
def get_field(field_id: str) -> dict:
    f = _field(field_id)
    g = f.grid
    ring = []
    for c, r in list(f.boundary) + [f.boundary[0]]:
        lat, lon = g.local_to_latlon(c * f.cell_m, r * f.cell_m)
        ring.append([round(lon, 7), round(lat, 7)])
    return {
        "id": f.id,
        "name": f.name,
        "crop": f.crop,
        "variety": f.variety,
        "grid": {"rows": f.rows, "cols": f.cols, "cell_m": f.cell_m, "origin": {"lat": f.origin_lat, "lon": f.origin_lon}},
        "boundary": {"type": "Polygon", "coordinates": [ring]},
        "water_edge": f.water_edge,
        "stations": [{"id": s.id, "kind": s.kind, "row": round(s.row, 2), "col": round(s.col, 2)} for s in stations(f)],
    }


@app.get("/api/fields/{field_id}/survey")
def get_survey(field_id: str, day: int = DayQ) -> dict:
    """Drone survey layers (per management cell)."""
    _field(field_id)
    s = simulate_survey(field_id, day)
    return {
        "field_id": field_id,
        "day": day,
        "captured_at": s.captured_at,
        "sensor": "5-band multispectral + LWIR thermal, 2x2 sub-pixels per 10 m cell",
        "layers": {
            "ndvi": _grid(s.ndvi),
            "ndre": _grid(s.ndre),
            "gndvi": _grid(s.gndvi),
            "thermal_c": _grid(s.bands["thermal"], 2),
            "texture": _grid(s.texture),
        },
        "cropped": s.cropped.astype(int).tolist(),
        "no_spray": s.no_spray.astype(int).tolist(),
        "stats": {
            "mean_ndvi": round(float(s.ndvi[s.cropped].mean()), 3),
            "p10_ndvi": round(float(np.percentile(s.ndvi[s.cropped], 10)), 3),
            "mean_canopy_temp_c": round(float(s.bands["thermal"][s.cropped].mean()), 2),
        },
    }


@app.get("/api/fields/{field_id}/detections")
def get_detections(field_id: str, day: int = DayQ, fuse: bool = True) -> dict:
    _field(field_id)
    det = _detect(field_id, day, fuse)
    return {
        "field_id": field_id,
        "day": day,
        "classes": list(CLASSES),
        "class_map": det.classes.astype(int).tolist(),
        "probabilities": {c: _grid(det.proba[..., k], 2) for k, c in enumerate(CLASSES) if k},
        "hotspots": det.hotspots,
        "sensor_context": det.sensor_context,
    }


@app.get("/api/fields/{field_id}/evaluation")
def get_evaluation(field_id: str, day: int = DayQ) -> dict:
    """Score this field's detection against the simulator's hidden ground truth."""
    _field(field_id)
    return {"field_id": field_id, "day": day, **evaluate_field(field_id, day)}


# --------------------------------------------------------------------------- #
# Prescriptions & missions
# --------------------------------------------------------------------------- #
class RxRequest(BaseModel):
    day: int = Field(DEFAULT_SEASON_DAY, ge=5, le=90)
    threshold: float = Field(0.5, ge=0.2, le=0.95, description="Action threshold on fused threat probability")
    buffer_cells: int = Field(1, ge=0, le=3, description="Cells of edge buffer around each patch")
    min_patch_cells: int = Field(2, ge=1, le=20)
    buffer_rate_fraction: float = Field(0.6, ge=0.0, le=1.0)
    no_spray_buffer: bool = True
    fuse_sensors: bool = True
    save: bool = False
    note: str | None = Field(None, max_length=500)


def _compute_rx(field_id: str, req: RxRequest):
    det = _detect(field_id, req.day, req.fuse_sensors)
    params = PrescriptionParams(req.threshold, req.buffer_cells, req.min_patch_cells, req.buffer_rate_fraction, req.no_spray_buffer)
    rx = build_prescription(det, params)
    mission = plan_mission(rx)
    return det, rx, mission


@app.post("/api/fields/{field_id}/prescriptions")
def create_prescription(field_id: str, req: RxRequest) -> dict:
    _field(field_id)
    _, rx, mission = _compute_rx(field_id, req)
    rates = {k: _grid(v) for k, v in rx.rates.items()}
    body = {
        "field_id": field_id,
        "day": req.day,
        "params": rx.params.__dict__,
        "summary": rx.summary,
        "rates": rates,
        "mission": mission,
    }
    if req.save:
        saved = store().save_prescription(field_id, req.day, rx.params.__dict__, rx.summary, rates, mission, req.note)
        body.update({"id": saved["id"], "status": saved["status"], "created_at": saved["created_at"]})
    return body


@app.get("/api/prescriptions")
def list_prescriptions(field_id: str | None = None) -> list[dict]:
    return store().list_prescriptions(field_id)


@app.get("/api/prescriptions/{rx_id}")
def get_prescription(rx_id: str) -> dict:
    rx = store().get_prescription(rx_id)
    if not rx:
        raise HTTPException(404, "Prescription not found")
    return rx


class StatusChange(BaseModel):
    status: Literal["draft", "approved", "flown", "archived"]


@app.post("/api/prescriptions/{rx_id}/status")
def set_prescription_status(rx_id: str, body: StatusChange) -> dict:
    if not store().get_prescription(rx_id, full=False):
        raise HTTPException(404, "Prescription not found")
    return store().set_status(rx_id, body.status)


def _rebuild(rx_id: str):
    saved = store().get_prescription(rx_id, full=False)
    if not saved:
        raise HTTPException(404, "Prescription not found")
    p = saved["params"]
    req = RxRequest(day=saved["day"], **p)
    return saved, _compute_rx(saved["field_id"], req)[1]


@app.get("/api/prescriptions/{rx_id}/geojson")
def prescription_as_geojson(rx_id: str):
    saved, rx = _rebuild(rx_id)
    return JSONResponse(prescription_geojson(rx), headers={"Content-Disposition": f'attachment; filename="{rx_id}.geojson"'}, media_type="application/geo+json")


@app.get("/api/prescriptions/{rx_id}/csv")
def prescription_as_csv(rx_id: str):
    saved, rx = _rebuild(rx_id)
    return PlainTextResponse(prescription_csv(rx), headers={"Content-Disposition": f'attachment; filename="{rx_id}.csv"'}, media_type="text/csv")


@app.get("/api/fields/{field_id}/prescription.geojson")
def preview_geojson(
    field_id: str,
    day: int = DayQ,
    threshold: float = Query(0.5, ge=0.2, le=0.95),
    buffer_cells: int = Query(1, ge=0, le=3),
    min_patch_cells: int = Query(2, ge=1, le=20),
    no_spray_buffer: bool = True,
    fuse_sensors: bool = True,
):
    """Unsaved prescription preview as GeoJSON (same parameters as POST /prescriptions)."""
    _field(field_id)
    req = RxRequest(day=day, threshold=threshold, buffer_cells=buffer_cells, min_patch_cells=min_patch_cells, no_spray_buffer=no_spray_buffer, fuse_sensors=fuse_sensors)
    _, rx, _ = _compute_rx(field_id, req)
    return JSONResponse(prescription_geojson(rx), media_type="application/geo+json")


@app.get("/api/products")
def products() -> list[dict]:
    return [p.__dict__ for p in PRODUCTS.values()]


# --------------------------------------------------------------------------- #
# Sensors & telemetry ingestion
# --------------------------------------------------------------------------- #
@app.get("/api/fields/{field_id}/sensors")
def get_sensors(field_id: str, day: int = DayQ) -> dict:
    f = _field(field_id)
    h = sensor_history(field_id, day)
    live = store().recent_readings(field_id, limit=200)
    out_stations = []
    for s in h["stations"]:
        series = {m: [round(float(v), 3) for v in vals] for m, vals in h["series"][s.id].items()}
        latest = {m: vals[-1] for m, vals in series.items()}
        for r in live:
            if r["station_id"] == s.id and r["metric"] not in latest.get("_live", {}):
                latest.setdefault("_live", {})[r["metric"]] = {"value": r["value"], "ts": r["ts"]}
        out_stations.append({"id": s.id, "kind": s.kind, "row": round(s.row, 2), "col": round(s.col, 2), "latest": latest, "series": series})
    det = _detect(f.id, day)
    return {
        "field_id": field_id,
        "timestamps": h["timestamps"],
        "metrics": {k: {"station_kind": v[0], "unit": v[1]} for k, v in METRICS.items()},
        "stations": out_stations,
        "disease_risk_index": det.sensor_context["disease_risk_index"],
        "traps": det.sensor_context["traps"],
        "trap_economic_threshold": det.sensor_context["trap_economic_threshold"],
        "live_readings": live[:50],
    }


class Reading(BaseModel):
    station_id: str = Field(..., examples=["north-40-trap-2"])
    metric: str = Field(..., examples=["trap_count"])
    value: float
    ts: datetime | None = None


class TelemetryBatch(BaseModel):
    readings: list[Reading] = Field(..., min_length=1, max_length=5000)


def _station_index() -> dict[str, tuple[str, str]]:
    return {s.id: (f.id, s.kind) for f in FIELDS for s in stations(f)}


@app.post("/api/telemetry", status_code=202)
def ingest(batch: TelemetryBatch) -> dict:
    """Ingest readings from field gateways (LoRaWAN / cellular). Validates station and metric."""
    idx = _station_index()
    rows, rejected = [], []
    for i, r in enumerate(batch.readings):
        st = idx.get(r.station_id)
        meta = METRICS.get(r.metric)
        if not st:
            rejected.append({"index": i, "reason": f"unknown station '{r.station_id}'"})
        elif not meta or meta[0] != st[1]:
            rejected.append({"index": i, "reason": f"metric '{r.metric}' not reported by a {st[1]} station"})
        elif not np.isfinite(r.value) or (r.metric == "trap_count" and r.value < 0):
            rejected.append({"index": i, "reason": "value out of range"})
        else:
            ts = (r.ts or datetime.now().astimezone()).isoformat()
            rows.append({"station_id": r.station_id, "field_id": st[0], "metric": r.metric, "value": float(r.value), "ts": ts})
    accepted = store().add_readings(rows) if rows else 0
    return {"accepted": accepted, "rejected": rejected}


@app.get("/api/telemetry")
def recent_telemetry(field_id: str | None = None, limit: int = Query(100, ge=1, le=1000)) -> list[dict]:
    return store().recent_readings(field_id, limit)


# --------------------------------------------------------------------------- #
# Analytics & model
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=8)
def _season(day: int) -> dict:
    weeks = list(range(day % 7 or 7, day + 1, 7))
    weeks = [d for d in weeks if d >= 6]
    per_field = {}
    for f in FIELDS:
        rows = []
        for d in weeks:
            rx = build_prescription(detect(f.id, d)).summary
            rows.append(
                {
                    "day": d,
                    "date": season_date(d).isoformat(),
                    "volume_l": rx["volume_l"],
                    "blanket_volume_l": rx["blanket_volume_l"],
                    "cost": rx["cost"],
                    "blanket_cost": rx["blanket_cost"],
                    "treated_fraction": rx["treated_fraction"],
                    "eiq_load": rx["eiq_load"],
                    "blanket_eiq_load": rx["blanket_eiq_load"],
                }
            )
        per_field[f.id] = rows
    timeline = []
    for i, d in enumerate(weeks):
        agg = {k: round(sum(per_field[f.id][i][k] for f in FIELDS), 2) for k in ("volume_l", "blanket_volume_l", "cost", "blanket_cost", "eiq_load", "blanket_eiq_load")}
        timeline.append({"day": d, "date": season_date(d).isoformat(), **agg})
    cum = {k: round(sum(t[k] for t in timeline), 2) for k in ("volume_l", "blanket_volume_l", "cost", "blanket_cost", "eiq_load", "blanket_eiq_load")}
    return {
        "assumption": "One weekly scan-and-spray pass per field, compared with a weekly blanket application of every product the field needed that week.",
        "timeline": timeline,
        "by_field": per_field,
        "cumulative": {
            **cum,
            "chemical_reduction_pct": round(100 * (1 - cum["volume_l"] / cum["blanket_volume_l"]), 1) if cum["blanket_volume_l"] else 0.0,
            "cost_saving": round(cum["blanket_cost"] - cum["cost"], 2),
            "eiq_reduction_pct": round(100 * (1 - cum["eiq_load"] / cum["blanket_eiq_load"]), 1) if cum["blanket_eiq_load"] else 0.0,
        },
    }


@app.get("/api/analytics/season")
def season(day: int = DayQ) -> dict:
    return _season(day)


@app.get("/api/model")
def model_card() -> dict:
    return get_model().describe()


# --------------------------------------------------------------------------- #
# RGB weed mapping
# --------------------------------------------------------------------------- #
MAX_UPLOAD = 12 * 1024 * 1024


@app.post("/api/vision/analyze")
async def vision_analyze(file: UploadFile = File(...), grid: int = Query(12, ge=4, le=40)) -> dict:
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image larger than 12 MB")
    try:
        return analyze_image(data, grid)
    except Exception as e:  # PIL raises many types for bad input
        raise HTTPException(422, f"Could not read image: {type(e).__name__}") from e


@app.get("/api/vision/sample.png")
def vision_sample(seed: int = Query(7, ge=0, le=10_000)) -> Response:
    return Response(sample_image(seed), media_type="image/png")


# --------------------------------------------------------------------------- #
# Static frontend (single-container deploys)
# --------------------------------------------------------------------------- #
_DIST = Path(os.environ.get("PATCHWORK_STATIC", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        target = _DIST / path
        if path and target.is_file() and _DIST in target.resolve().parents:
            return FileResponse(target)
        return FileResponse(_DIST / "index.html")
