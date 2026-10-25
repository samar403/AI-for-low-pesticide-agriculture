"""Deterministic simulator for drone surveys and in-field sensors.

There is no real hardware attached to this demo, so every field gets a
physically plausible synthetic twin:

* A multispectral drone survey (green, red, red-edge, NIR and thermal bands)
  rendered at 2x2 sub-pixels per management cell, so per-cell texture is real.
* Persistent threat patches (weeds, insect pests, fungal disease) that start
  small and grow through the season.
* A network of ground stations: soil moisture, air temperature, humidity,
  leaf wetness and insect pheromone-trap counts.

Everything is seeded, so the same field + day always yields the same data.
Ground-truth masks are returned alongside the imagery; they are used only to
train and evaluate the detector, never by the detector at inference time.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache

import numpy as np

from .geo import GridSpec, box_blur, polygon_mask

CLASSES = ("healthy", "weed", "pest", "disease")
SEASON_START = date(2026, 8, 31)
DEFAULT_SEASON_DAY = 55  # the "today" of the demo farm


@dataclass(frozen=True)
class FieldDef:
    id: str
    name: str
    crop: str
    variety: str
    rows: int
    cols: int
    cell_m: float
    origin_lat: float
    origin_lon: float
    seed: int
    # Boundary polygon in (col, row) grid units. Cells outside are not cropped.
    boundary: tuple[tuple[float, float], ...]
    # Optional water feature along an edge: cells within the buffer are no-spray.
    water_edge: str | None = None
    threat_mix: tuple[float, float, float] = (1.0, 1.0, 1.0)  # weed, pest, disease

    @property
    def grid(self) -> GridSpec:
        return GridSpec(self.rows, self.cols, self.cell_m, self.origin_lat, self.origin_lon)


FIELDS: tuple[FieldDef, ...] = (
    FieldDef(
        id="north-40",
        name="North 40",
        crop="Maize",
        variety="Dent corn, 76 cm rows",
        rows=40,
        cols=56,
        cell_m=10.0,
        origin_lat=36.7412,
        origin_lon=-119.8021,
        seed=11,
        boundary=((0, 0), (56, 0), (56, 31), (44, 40), (0, 40)),
        water_edge="west",
        threat_mix=(1.3, 0.9, 0.5),
    ),
    FieldDef(
        id="creekside",
        name="Creekside",
        crop="Tomato",
        variety="Processing tomato, drip",
        rows=34,
        cols=48,
        cell_m=10.0,
        origin_lat=36.7339,
        origin_lon=-119.7934,
        seed=23,
        boundary=((0, 3), (6, 0), (48, 0), (48, 34), (0, 34)),
        water_edge="south",
        threat_mix=(0.6, 1.1, 1.5),
    ),
    FieldDef(
        id="mesa-block",
        name="Mesa Block",
        crop="Cotton",
        variety="Pima, 1 m rows",
        rows=44,
        cols=44,
        cell_m=10.0,
        origin_lat=36.7480,
        origin_lon=-119.7855,
        seed=37,
        boundary=((0, 0), (44, 0), (44, 44), (0, 44)),
        threat_mix=(0.9, 1.5, 0.4),
    ),
    FieldDef(
        id="far-quarter",
        name="Far Quarter",
        crop="Soybean",
        variety="Group IV, 38 cm rows",
        rows=30,
        cols=62,
        cell_m=10.0,
        origin_lat=36.7287,
        origin_lon=-119.8108,
        seed=41,
        boundary=((0, 0), (62, 0), (62, 30), (8, 30), (0, 22)),
        threat_mix=(1.2, 0.7, 1.0),
    ),
)

FIELDS_BY_ID = {f.id: f for f in FIELDS}


def training_field(seed: int) -> FieldDef:
    """Synthetic fields used only for model training / evaluation."""
    rng = np.random.default_rng(seed)
    rows, cols = int(rng.integers(30, 46)), int(rng.integers(36, 60))
    return FieldDef(
        id=f"train-{seed}",
        name=f"Training {seed}",
        crop="Mixed",
        variety="synthetic",
        rows=rows,
        cols=cols,
        cell_m=10.0,
        origin_lat=36.7,
        origin_lon=-119.8,
        seed=seed,
        boundary=((0, 0), (cols, 0), (cols, rows), (0, rows)),
        threat_mix=tuple(float(x) for x in rng.uniform(0.6, 1.5, 3)),
    )


# --------------------------------------------------------------------------- #
# Threat patches
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Patch:
    kind: int  # index into CLASSES (1..3)
    row: float
    col: float
    onset_day: int
    growth: float  # cells of radius per 10 days
    max_radius: float
    elongation: float
    angle: float


def _patches(f: FieldDef) -> list[Patch]:
    rng = np.random.default_rng(f.seed * 7919)
    out: list[Patch] = []
    base_counts = (4, 3, 2)
    for kind_idx, (base, mix) in enumerate(zip(base_counts, f.threat_mix), start=1):
        n = max(1, int(round(base * mix + rng.uniform(-0.5, 0.5))))
        for _ in range(n):
            out.append(
                Patch(
                    kind=kind_idx,
                    row=float(rng.uniform(2, f.rows - 2)),
                    col=float(rng.uniform(2, f.cols - 2)),
                    onset_day=int(rng.integers(5, 40)),
                    growth=float(rng.uniform(0.6, 1.4)),
                    max_radius=float(rng.uniform(2.0, 5.5)),
                    # weeds follow the planter/cultivator direction, so they
                    # stretch along rows; pests and disease are rounder.
                    elongation=float(rng.uniform(1.6, 2.6) if kind_idx == 1 else rng.uniform(1.0, 1.5)),
                    angle=float(0.0 if kind_idx == 1 else rng.uniform(0, math.pi)),
                )
            )
    return out


def _patch_intensity(f: FieldDef, day: int, sub: int) -> np.ndarray:
    """Per-class intensity in [0, 1] at sub-pixel resolution. Shape (3, R*sub, C*sub)."""
    R, C = f.rows * sub, f.cols * sub
    yy, xx = np.mgrid[0:R, 0:C]
    yy = (yy + 0.5) / sub
    xx = (xx + 0.5) / sub
    out = np.zeros((3, R, C))
    for p in _patches(f):
        age = day - p.onset_day
        if age <= 0:
            continue
        radius = min(p.max_radius, 0.6 + p.growth * age / 10.0)
        dy, dx = yy - p.row, xx - p.col
        ca, sa = math.cos(p.angle), math.sin(p.angle)
        u = (dx * ca + dy * sa) / (radius * p.elongation)
        v = (-dx * sa + dy * ca) / radius
        d2 = u * u + v * v
        strength = min(1.0, 0.35 + age / 30.0)
        out[p.kind - 1] = np.maximum(out[p.kind - 1], strength * np.exp(-1.6 * d2))
    return out


# --------------------------------------------------------------------------- #
# Drone survey
# --------------------------------------------------------------------------- #
def _smooth_noise(shape: tuple[int, int], scale: int, rng: np.random.Generator) -> np.ndarray:
    small = rng.normal(size=(shape[0] // scale + 3, shape[1] // scale + 3))
    big = np.kron(small, np.ones((scale, scale)))[: shape[0] + scale, : shape[1] + scale]
    big = box_blur(big, max(1, scale // 2))
    off = scale // 2
    out = big[off : off + shape[0], off : off + shape[1]]
    return (out - out.mean()) / (out.std() + 1e-9)


@dataclass
class Survey:
    field_id: str
    day: int
    captured_at: str
    bands: dict[str, np.ndarray]  # per-cell mean reflectance / temperature
    texture: np.ndarray  # per-cell NIR coefficient of variation
    exg: np.ndarray  # excess-green index from the RGB sensor
    cropped: np.ndarray  # bool mask of cropped cells
    no_spray: np.ndarray  # bool mask of regulatory no-spray buffer cells
    truth: np.ndarray  # int class per cell (ground truth, for training/eval only)
    truth_intensity: np.ndarray = field(repr=False, default=None)  # (3, R, C)

    @property
    def ndvi(self) -> np.ndarray:
        b = self.bands
        return (b["nir"] - b["red"]) / (b["nir"] + b["red"] + 1e-9)

    @property
    def ndre(self) -> np.ndarray:
        b = self.bands
        return (b["nir"] - b["red_edge"]) / (b["nir"] + b["red_edge"] + 1e-9)

    @property
    def gndvi(self) -> np.ndarray:
        b = self.bands
        return (b["nir"] - b["green"]) / (b["nir"] + b["green"] + 1e-9)


def season_date(day: int) -> date:
    return SEASON_START + timedelta(days=day)


def no_spray_mask(f: FieldDef, buffer_m: float = 15.0) -> np.ndarray:
    m = np.zeros((f.rows, f.cols), dtype=bool)
    n = int(math.ceil(buffer_m / f.cell_m))
    if f.water_edge == "west":
        m[:, :n] = True
    elif f.water_edge == "east":
        m[:, -n:] = True
    elif f.water_edge == "south":
        m[-n:, :] = True
    elif f.water_edge == "north":
        m[:n, :] = True
    return m


@lru_cache(maxsize=256)
def simulate_survey(field_id: str, day: int = DEFAULT_SEASON_DAY) -> Survey:
    f = FIELDS_BY_ID[field_id] if field_id in FIELDS_BY_ID else training_field(int(field_id.split("-")[1]))
    return _simulate(f, day)


def _simulate(f: FieldDef, day: int) -> Survey:
    sub = 2
    R, C = f.rows * sub, f.cols * sub
    rng = np.random.default_rng(f.seed * 1000 + day)
    static_rng = np.random.default_rng(f.seed)

    # Crop development: canopy closes over the first ~45 days of the window.
    canopy = 0.55 + 0.35 * (1 - math.exp(-day / 25.0))
    vigor = canopy + 0.06 * _smooth_noise((R, C), 12, static_rng) + 0.02 * _smooth_noise((R, C), 4, rng)
    # Crop rows: periodic modulation of biomass across rows.
    cols_idx = np.arange(C)[None, :]
    row_wave = 0.5 + 0.5 * np.cos(2 * math.pi * cols_idx / 3.0)
    vigor = vigor * (0.88 + 0.12 * row_wave)

    inten = _patch_intensity(f, day, sub)
    weed, pest, dis = inten
    # Weeds: extra green biomass in the inter-row, speckled at sub-pixel scale.
    speckle = (rng.random((R, C)) < 0.55).astype(float)
    weed_bio = weed * speckle * (1 - row_wave) * 0.9

    nir = 0.46 * vigor + 0.30 * weed_bio - 0.20 * pest - 0.07 * dis
    red = 0.055 * (1.6 - vigor) + 0.03 * pest + 0.012 * dis - 0.01 * weed_bio
    red_edge = 0.24 * vigor + 0.10 * weed_bio - 0.06 * pest + 0.09 * dis
    green = 0.075 + 0.02 * vigor + 0.03 * weed_bio + 0.012 * dis - 0.01 * pest
    thermal = 27.0 + 1.2 * _smooth_noise((R, C), 16, static_rng) + 2.4 * pest + 0.9 * dis - 0.4 * weed_bio

    noise = lambda s: rng.normal(0, s, (R, C))  # noqa: E731
    sub_bands = {
        "nir": np.clip(nir + noise(0.012), 0.02, 0.9),
        "red": np.clip(red + noise(0.004), 0.005, 0.4),
        "red_edge": np.clip(red_edge + noise(0.008), 0.02, 0.6),
        "green": np.clip(green + noise(0.004), 0.01, 0.4),
        "thermal": thermal + noise(0.25),
    }

    def to_cells(a: np.ndarray) -> np.ndarray:
        return a.reshape(f.rows, sub, f.cols, sub).mean(axis=(1, 3))

    bands = {k: to_cells(v) for k, v in sub_bands.items()}
    nir_sub = sub_bands["nir"].reshape(f.rows, sub, f.cols, sub)
    texture = nir_sub.std(axis=(1, 3)) / (nir_sub.mean(axis=(1, 3)) + 1e-9)
    g, r = bands["green"], bands["red"]
    blue = 0.04 + 0.01 * rng.random((f.rows, f.cols))
    tot = g + r + blue
    exg = (2 * g - r - blue) / tot

    cell_inten = inten.reshape(3, f.rows, sub, f.cols, sub).mean(axis=(2, 4))
    truth = np.zeros((f.rows, f.cols), dtype=np.int8)
    # Order matters: later assignments win when threats overlap.
    for k, thr in ((1, 0.28), (3, 0.32), (2, 0.32)):
        truth[cell_inten[k - 1] > thr] = k

    cropped = polygon_mask(f.rows, f.cols, list(f.boundary))
    truth[~cropped] = 0
    for k in bands:
        bands[k] = np.where(cropped, bands[k], np.nan if k != "thermal" else 31.0)
    bands = {k: np.nan_to_num(v, nan=0.03) for k, v in bands.items()}
    captured = datetime.combine(season_date(day), datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=10, minutes=12)
    return Survey(
        field_id=f.id,
        day=day,
        captured_at=captured.isoformat(),
        bands=bands,
        texture=np.where(cropped, texture, 0.0),
        exg=np.where(cropped, exg, 0.0),
        cropped=cropped,
        no_spray=no_spray_mask(f) & cropped,
        truth=truth,
        truth_intensity=cell_inten,
    )


# --------------------------------------------------------------------------- #
# Ground sensors
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Station:
    id: str
    row: float
    col: float
    kind: str  # "weather" | "trap" | "soil"


def stations(f: FieldDef) -> list[Station]:
    rng = np.random.default_rng(f.seed * 31)
    out: list[Station] = []
    cropped = polygon_mask(f.rows, f.cols, list(f.boundary))
    n_traps = 6
    # Traps on a jittered lattice so the whole field is covered.
    gr, gc = 2, 3
    i = 0
    for a in range(gr):
        for b in range(gc):
            for _ in range(20):
                r = (a + 0.5) * f.rows / gr + rng.uniform(-3, 3)
                c = (b + 0.5) * f.cols / gc + rng.uniform(-3, 3)
                if cropped[int(np.clip(r, 0, f.rows - 1)), int(np.clip(c, 0, f.cols - 1))]:
                    break
            i += 1
            out.append(Station(f"{f.id}-trap-{i}", float(r), float(c), "trap"))
            if i >= n_traps:
                break
    out.append(Station(f"{f.id}-wx-1", f.rows * 0.5, f.cols * 0.5, "weather"))
    out.append(Station(f"{f.id}-soil-1", f.rows * 0.3, f.cols * 0.25, "soil"))
    out.append(Station(f"{f.id}-soil-2", f.rows * 0.7, f.cols * 0.75, "soil"))
    return out


METRICS = {
    "air_temp_c": ("weather", "°C"),
    "humidity_pct": ("weather", "%"),
    "leaf_wetness": ("weather", "fraction"),
    "rain_mm": ("weather", "mm"),
    "soil_moisture_pct": ("soil", "% VWC"),
    "soil_temp_c": ("soil", "°C"),
    "trap_count": ("trap", "insects / day"),
}


@lru_cache(maxsize=64)
def sensor_history(field_id: str, day: int = DEFAULT_SEASON_DAY, days: int = 14) -> dict:
    """Synthetic time series for every station: 3-hourly weather/soil, daily trap counts."""
    f = FIELDS_BY_ID[field_id]
    rng = np.random.default_rng(f.seed * 97 + day)
    end = datetime.combine(season_date(day), datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=9)
    steps = days * 8
    ts = [end - timedelta(hours=3 * (steps - 1 - i)) for i in range(steps)]
    hours = np.array([t.hour for t in ts])
    diurnal = np.cos((hours - 15) / 24 * 2 * math.pi)
    # A wet spell partway through the window drives disease pressure.
    wet = np.zeros(steps)
    start = int(steps * (0.35 + 0.2 * (f.seed % 3) / 2))
    wet[start : start + 14 + f.seed % 10] = 1.0
    temp = 21 + 7 * diurnal + rng.normal(0, 0.8, steps) - 3 * wet
    hum = np.clip(62 - 22 * diurnal + 25 * wet + rng.normal(0, 3, steps), 15, 100)
    leaf = np.clip((hum - 80) / 18 + 0.4 * wet, 0, 1)
    rain = np.where(wet > 0, np.clip(rng.gamma(1.2, 1.6, steps), 0, None), 0.0)

    sts = stations(f)
    inten = _patch_intensity(f, day, 1)  # (3, rows, cols) at cell resolution
    series: dict[str, dict] = {}
    for s in sts:
        if s.kind == "weather":
            series[s.id] = {
                "air_temp_c": np.round(temp, 2),
                "humidity_pct": np.round(hum, 1),
                "leaf_wetness": np.round(leaf, 3),
                "rain_mm": np.round(rain, 2),
            }
        elif s.kind == "soil":
            sm = 31 - np.linspace(0, 6, steps) + np.cumsum(rain) * 0.4 + rng.normal(0, 0.3, steps)
            series[s.id] = {
                "soil_moisture_pct": np.round(np.clip(sm, 8, 48), 2),
                "soil_temp_c": np.round(19 + 3 * np.roll(diurnal, 1) + rng.normal(0, 0.3, steps), 2),
            }
        else:
            r, c = int(np.clip(s.row, 0, f.rows - 1)), int(np.clip(s.col, 0, f.cols - 1))
            # Pheromone traps draw moths from ~60 m around them.
            r0, r1 = max(0, r - 6), min(f.rows, r + 7)
            c0, c1 = max(0, c - 6), min(f.cols, c + 7)
            pressure = float(inten[1, r0:r1, c0:c1].max())
            daily = rng.poisson(1.5 + 30 * pressure * np.linspace(0.5, 1.0, days))
            series[s.id] = {"trap_count": np.repeat(daily, 8).astype(float)}
    return {
        "timestamps": [t.isoformat() for t in ts],
        "stations": sts,
        "series": series,
    }


def disease_risk_index(history: dict) -> float:
    """Fraction of the last 7 days' hours that were wet and in the 12-26 °C infection window.

    A simplified hours-of-leaf-wetness model in the spirit of TOM-CAST/Mills
    tables: risk saturates once ~40% of hours were conducive.
    """
    wx = next(v for k, v in history["series"].items() if "-wx-" in k)
    leaf = wx["leaf_wetness"][-56:]
    temp = wx["air_temp_c"][-56:]
    conducive = ((leaf > 0.5) & (temp >= 12) & (temp <= 26)).mean()
    return float(min(1.0, conducive / 0.4))
