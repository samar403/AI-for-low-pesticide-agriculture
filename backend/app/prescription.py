"""Turn detections into a variable-rate spray prescription, a drone mission and savings numbers.

Agronomic rules applied, in order:

1. A cell is a treatment target for a product when its fused probability for
   that threat is at or above the action threshold.
2. Patches smaller than ``min_patch_cells`` are dropped (scouting, not spraying).
3. Targets are expanded by ``buffer_cells`` so the patch edge, where the
   threat is spreading, is covered too. Buffer cells get a reduced rate.
4. Rate inside a target scales with confidence between 60% and 100% of the
   label rate. It never exceeds the label rate.
5. Regulatory no-spray buffers (e.g. along watercourses) and non-cropped cells
   are always zero, whatever the model says.

Blanket baseline: what a conventional programme would apply, i.e. full label
rate over the whole cropped area for every product the field needs.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np

from .detector import Detection
from .geo import connected_components, dilate
from .simulator import CLASSES, FIELDS_BY_ID, simulate_survey


@dataclass(frozen=True)
class Product:
    key: str
    target: str  # class name
    name: str
    active_ingredient: str
    label_rate_l_ha: float  # product, not tank mix
    price_per_l: float
    eiq: float  # Environmental Impact Quotient of the formulated product (Cornell EIQ)
    ai_fraction: float  # kg active ingredient per litre of product


PRODUCTS: dict[str, Product] = {
    "herbicide": Product("herbicide", "weed", "Glufosinate 280 SL", "glufosinate-ammonium", 2.5, 14.8, 20.2, 0.28),
    "insecticide": Product("insecticide", "pest", "Spinosad 480 SC", "spinosad", 0.25, 182.0, 15.1, 0.48),
    "fungicide": Product("fungicide", "disease", "Azoxystrobin 250 SC", "azoxystrobin", 1.0, 41.5, 26.3, 0.25),
}

CARRIER_L_HA = 15.0  # drone spray-mix volume per treated hectare


@dataclass
class PrescriptionParams:
    threshold: float = 0.5
    buffer_cells: int = 1
    min_patch_cells: int = 2
    buffer_rate_fraction: float = 0.6
    no_spray_buffer: bool = True

    def clamp(self) -> "PrescriptionParams":
        return PrescriptionParams(
            threshold=float(np.clip(self.threshold, 0.2, 0.95)),
            buffer_cells=int(np.clip(self.buffer_cells, 0, 3)),
            min_patch_cells=int(np.clip(self.min_patch_cells, 1, 20)),
            buffer_rate_fraction=float(np.clip(self.buffer_rate_fraction, 0.0, 1.0)),
            no_spray_buffer=bool(self.no_spray_buffer),
        )


@dataclass
class Prescription:
    field_id: str
    day: int
    params: PrescriptionParams
    rates: dict[str, np.ndarray]  # product key -> L/ha per cell
    summary: dict


def build_prescription(det: Detection, params: PrescriptionParams | None = None) -> Prescription:
    params = (params or PrescriptionParams()).clamp()
    f = FIELDS_BY_ID[det.field_id]
    s = simulate_survey(det.field_id, det.day)
    allowed = s.cropped & ~(s.no_spray if params.no_spray_buffer else np.zeros_like(s.cropped))
    cell_ha = f.grid.cell_area_ha
    cropped_ha = float(s.cropped.sum() * cell_ha)

    rates: dict[str, np.ndarray] = {}
    per_product = []
    any_cell = np.zeros(s.cropped.shape, dtype=bool)
    for key, prod in PRODUCTS.items():
        k = CLASSES.index(prod.target)
        p = det.proba[..., k]
        target = (p >= params.threshold) & s.cropped
        labels, n = connected_components(target)
        if n:
            sizes = np.bincount(labels.ravel(), minlength=n + 1)
            keep = sizes >= params.min_patch_cells
            keep[0] = False
            target = keep[labels]
        buffered = dilate(target, params.buffer_cells) & s.cropped & ~target
        sev = np.clip((p - params.threshold) / max(1e-6, 1 - params.threshold), 0, 1)
        rate = np.zeros_like(p)
        rate[target] = prod.label_rate_l_ha * (0.6 + 0.4 * sev[target])
        rate[buffered] = prod.label_rate_l_ha * params.buffer_rate_fraction
        rate[~allowed] = 0.0
        rate = np.round(rate, 3)
        rates[key] = rate
        treated = rate > 0
        any_cell |= treated
        vol = float(rate.sum() * cell_ha)
        needed = bool(target.any())
        blanket = prod.label_rate_l_ha * cropped_ha if needed else 0.0
        per_product.append(
            {
                **asdict(prod),
                "needed": needed,
                "treated_cells": int(treated.sum()),
                "treated_ha": round(float(treated.sum() * cell_ha), 3),
                "volume_l": round(vol, 3),
                "blanket_volume_l": round(blanket, 3),
                "cost": round(vol * prod.price_per_l, 2),
                "blanket_cost": round(blanket * prod.price_per_l, 2),
                "active_ingredient_kg": round(vol * prod.ai_fraction, 3),
                "blanket_active_ingredient_kg": round(blanket * prod.ai_fraction, 3),
                # EIQ field use rating = EIQ x %AI x rate; summed over area here.
                "eiq_load": round(prod.eiq * vol * prod.ai_fraction, 2),
                "blanket_eiq_load": round(prod.eiq * blanket * prod.ai_fraction, 2),
                "excluded_by_buffer_cells": int((target & ~allowed & s.cropped).sum()),
            }
        )

    def total(key: str) -> float:
        return round(sum(p[key] for p in per_product), 3)

    vol, bvol = total("volume_l"), total("blanket_volume_l")
    cost, bcost = total("cost"), total("blanket_cost")
    eiq, beiq = total("eiq_load"), total("blanket_eiq_load")
    treated_ha = float(any_cell.sum() * cell_ha)
    summary = {
        "cropped_ha": round(cropped_ha, 2),
        "treated_ha": round(treated_ha, 2),
        "treated_fraction": round(treated_ha / cropped_ha, 4) if cropped_ha else 0.0,
        "volume_l": vol,
        "blanket_volume_l": bvol,
        "cost": round(cost, 2),
        "blanket_cost": round(bcost, 2),
        "eiq_load": eiq,
        "blanket_eiq_load": beiq,
        "active_ingredient_kg": total("active_ingredient_kg"),
        "blanket_active_ingredient_kg": total("blanket_active_ingredient_kg"),
        "chemical_reduction_pct": round(100 * (1 - vol / bvol), 1) if bvol else 0.0,
        "cost_saving": round(bcost - cost, 2),
        "eiq_reduction_pct": round(100 * (1 - eiq / beiq), 1) if beiq else 0.0,
        "tank_mix_l": round(treated_ha * CARRIER_L_HA, 1),
        "blanket_tank_mix_l": round(cropped_ha * CARRIER_L_HA * (1 if bvol else 0), 1),
        "products": per_product,
        "no_spray_cells": int((s.no_spray & s.cropped).sum()) if params.no_spray_buffer else 0,
    }
    return Prescription(field_id=det.field_id, day=det.day, params=params, rates=rates, summary=summary)


def prescription_geojson(rx: Prescription) -> dict:
    """Per-cell polygons with product rates, readable by most farm-management and drone GCS software."""
    f = FIELDS_BY_ID[rx.field_id]
    g = f.grid
    feats = []
    stack = np.stack([rx.rates[k] for k in PRODUCTS], axis=-1)
    for r, c in np.argwhere(stack.sum(axis=-1) > 0):
        props = {f"{k}_l_ha": float(rx.rates[k][r, c]) for k in PRODUCTS}
        props.update({"row": int(r), "col": int(c)})
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [g.cell_polygon(int(r), int(c))]}, "properties": props})
    return {
        "type": "FeatureCollection",
        "name": f"{f.name} prescription, season day {rx.day}",
        "properties": {"field_id": f.id, "crop": f.crop, "cell_m": f.cell_m, "carrier_l_ha": CARRIER_L_HA, "products": {k: asdict(p) for k, p in PRODUCTS.items()}},
        "features": feats,
    }


def prescription_csv(rx: Prescription) -> str:
    f = FIELDS_BY_ID[rx.field_id]
    g = f.grid
    header = ["row", "col", "lat", "lon"] + [f"{k}_l_ha" for k in PRODUCTS]
    lines = [",".join(header)]
    stack = np.stack([rx.rates[k] for k in PRODUCTS], axis=-1)
    for r, c in np.argwhere(stack.sum(axis=-1) > 0):
        lat, lon = g.cell_center_latlon(int(r), int(c))
        lines.append(",".join([str(r), str(c), f"{lat:.7f}", f"{lon:.7f}"] + [f"{rx.rates[k][r, c]:.3f}" for k in PRODUCTS]))
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# Drone mission planning
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class DroneSpec:
    name: str = "Generic 40 L spray drone"
    tank_l: float = 40.0
    swath_m: float = 10.0  # equals one grid cell width: one pass per cell row
    spray_speed_ms: float = 6.0
    transit_speed_ms: float = 10.0
    flight_min_per_battery: float = 11.0
    refill_min: float = 3.0


def plan_mission(rx: Prescription, drone: DroneSpec | None = None) -> dict:
    """Boustrophedon passes over only the cell rows that contain spray segments."""
    drone = drone or DroneSpec()
    f = FIELDS_BY_ID[rx.field_id]
    g = f.grid
    spray = np.zeros((f.rows, f.cols), dtype=bool)
    for r in rx.rates.values():
        spray |= r > 0

    waypoints: list[dict] = []
    spray_m = 0.0
    transit_m = 0.0
    pos = (0.0, 0.0)  # launch point: NW corner of the field, in metres (x east, y south)
    flip = False
    segments = 0
    for row in range(f.rows):
        cols = np.flatnonzero(spray[row])
        if cols.size == 0:
            continue
        runs = np.split(cols, np.flatnonzero(np.diff(cols) > 1) + 1)
        runs = runs[::-1] if flip else runs
        y = (row + 0.5) * f.cell_m
        for run in runs:
            a, b = run[0] * f.cell_m, (run[-1] + 1) * f.cell_m
            start, end = ((b, y), (a, y)) if flip else ((a, y), (b, y))
            transit_m += math.dist(pos, start)
            spray_m += abs(b - a)
            for (x, yy), on in ((start, True), (end, False)):
                lat, lon = g.local_to_latlon(x, yy)
                waypoints.append({"lat": round(lat, 7), "lon": round(lon, 7), "x_m": round(x, 1), "y_m": round(yy, 1), "spray": on})
            pos = end
            segments += 1
        flip = not flip
    transit_m += math.dist(pos, (0.0, 0.0))

    flight_s = spray_m / drone.spray_speed_ms + transit_m / drone.transit_speed_ms
    tank_mix = rx.summary["tank_mix_l"]
    refills = max(0, math.ceil(tank_mix / drone.tank_l) - 1)
    batteries = max(1, math.ceil(flight_s / 60 / drone.flight_min_per_battery)) if segments else 0
    total_min = flight_s / 60 + refills * drone.refill_min

    # Blanket comparison: every cropped cell row, full length.
    s = simulate_survey(rx.field_id, rx.day)
    blanket_spray_m = float(s.cropped.sum() * f.cell_m)
    blanket_flight_s = blanket_spray_m / drone.spray_speed_ms + f.rows * f.cell_m / drone.transit_speed_ms
    blanket_mix = rx.summary["cropped_ha"] * CARRIER_L_HA
    blanket_refills = max(0, math.ceil(blanket_mix / drone.tank_l) - 1)
    blanket_min = blanket_flight_s / 60 + blanket_refills * drone.refill_min

    return {
        "drone": asdict(drone),
        "segments": segments,
        "spray_distance_m": round(spray_m, 1),
        "transit_distance_m": round(transit_m, 1),
        "flight_time_min": round(flight_s / 60, 1),
        "total_time_min": round(total_min, 1),
        "tank_mix_l": tank_mix,
        "tank_refills": refills,
        "battery_sets": batteries,
        "blanket_total_time_min": round(blanket_min, 1),
        "time_saving_pct": round(100 * (1 - total_min / blanket_min), 1) if blanket_min and segments else 0.0,
        "waypoints": waypoints,
    }
