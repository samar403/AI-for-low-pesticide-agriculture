"""Hotspot detector: per-cell threat classification from drone imagery, fused with sensors.

Model
-----
A multinomial logistic-regression classifier over hand-engineered agronomic
features (vegetation indices, local anomalies, sub-cell texture, canopy
temperature). It is deliberately small: it trains in about a second on the
simulator, is fully explainable (per-feature weights are exposed through the
API), and runs on a field-edge laptop or drone companion computer without a GPU.

The interface (``predict_proba(features) -> (N, 4)``) matches what a CNN
segmentation model would expose, so a heavier model can be dropped in later.

Sensor fusion
-------------
Imagery sees symptoms; sensors see causes. After the image model runs we
adjust class log-odds with two ground-truth signals:

* insect-trap counts, interpolated across the field (inverse-distance) and
  scaled against an economic threshold, raise or lower pest probability;
* a leaf-wetness disease-risk index raises or lowers disease probability.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .geo import box_blur, connected_components
from .simulator import CLASSES, FIELDS_BY_ID, Survey, disease_risk_index, sensor_history, simulate_survey

FEATURES = (
    "ndvi",
    "ndre",
    "gndvi",
    "ndvi_anomaly",
    "ndre_anomaly",
    "thermal_anomaly",
    "texture",
    "exg_anomaly",
)

TRAP_ECONOMIC_THRESHOLD = 12.0  # insects / trap / day that justify treatment


def extract_features(s: Survey) -> np.ndarray:
    """Return an (rows, cols, F) feature cube."""
    ndvi, ndre, gndvi = s.ndvi, s.ndre, s.gndvi
    crop = s.cropped

    def local_anomaly(a: np.ndarray, radius: int = 6) -> np.ndarray:
        # Compare each cell to its neighbourhood, ignoring non-cropped cells.
        w = box_blur(crop.astype(float), radius)
        m = box_blur(np.where(crop, a, 0.0), radius) / np.maximum(w, 1e-6)
        return a - m

    thermal = s.bands["thermal"]
    t_med = np.median(thermal[crop]) if crop.any() else 0.0
    cube = np.stack(
        [
            ndvi,
            ndre,
            gndvi,
            local_anomaly(ndvi),
            local_anomaly(ndre),
            thermal - t_med,
            s.texture,
            local_anomaly(s.exg),
        ],
        axis=-1,
    )
    return np.where(crop[..., None], cube, 0.0)


@dataclass
class Model:
    mean: np.ndarray
    std: np.ndarray
    W: np.ndarray  # (F, K)
    b: np.ndarray  # (K,)
    metrics: dict

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        Z = ((X - self.mean) / self.std) @ self.W + self.b
        Z -= Z.max(axis=1, keepdims=True)
        P = np.exp(Z)
        return P / P.sum(axis=1, keepdims=True)

    def describe(self) -> dict:
        return {
            "type": "multinomial logistic regression",
            "classes": list(CLASSES),
            "features": list(FEATURES),
            "weights": {
                cls: {feat: round(float(self.W[i, k]), 3) for i, feat in enumerate(FEATURES)}
                for k, cls in enumerate(CLASSES)
            },
            "metrics": self.metrics,
        }


TRAIN_SEEDS = tuple(range(1001, 1013))
EVAL_SEEDS = tuple(range(2001, 2005))
TRAIN_DAYS = (30, 42, 55, 68)


def _dataset(seeds: tuple[int, ...], days: tuple[int, ...]) -> tuple[np.ndarray, np.ndarray]:
    Xs, ys = [], []
    for seed in seeds:
        for day in days:
            s = simulate_survey(f"train-{seed}", day)
            X = extract_features(s)[s.cropped]
            Xs.append(X)
            ys.append(s.truth[s.cropped].astype(int))
    return np.concatenate(Xs), np.concatenate(ys)


def _confusion(y: np.ndarray, yhat: np.ndarray, k: int) -> np.ndarray:
    cm = np.zeros((k, k), dtype=int)
    np.add.at(cm, (y, yhat), 1)
    return cm


def _metrics(cm: np.ndarray) -> dict:
    out = {}
    for i, cls in enumerate(CLASSES):
        tp = cm[i, i]
        prec = tp / max(1, cm[:, i].sum())
        rec = tp / max(1, cm[i, :].sum())
        f1 = 2 * prec * rec / max(1e-9, prec + rec)
        out[cls] = {"precision": round(float(prec), 3), "recall": round(float(rec), 3), "f1": round(float(f1), 3), "support": int(cm[i, :].sum())}
    out["accuracy"] = round(float(np.trace(cm) / cm.sum()), 4)
    threat = cm[1:, 1:].sum()
    # "Threat recall": a threat cell flagged as any threat still gets treated.
    out["threat_detection_rate"] = round(float(threat / max(1, cm[1:, :].sum())), 3)
    out["false_spray_rate"] = round(float(cm[0, 1:].sum() / max(1, cm[0, :].sum())), 4)
    out["confusion_matrix"] = cm.tolist()
    return out


def train(epochs: int = 600, lr: float = 0.08, l2: float = 1e-3) -> Model:
    X, y = _dataset(TRAIN_SEEDS, TRAIN_DAYS)
    mean, std = X.mean(axis=0), X.std(axis=0) + 1e-9
    Xn = (X - mean) / std
    n, F = Xn.shape
    K = len(CLASSES)
    Y = np.eye(K)[y]
    # Inverse-frequency class weights (square-rooted) so rare threats are not ignored.
    freq = np.bincount(y, minlength=K) / n
    cw = 1.0 / np.sqrt(np.maximum(freq, 1e-4))
    sw = cw[y] / cw[y].mean()
    rng = np.random.default_rng(0)
    W = rng.normal(0, 0.01, (F, K))
    b = np.zeros(K)
    mW, vW, mb, vb = np.zeros_like(W), np.zeros_like(W), np.zeros_like(b), np.zeros_like(b)
    b1, b2, eps = 0.9, 0.999, 1e-8
    for t in range(1, epochs + 1):
        Z = Xn @ W + b
        Z -= Z.max(axis=1, keepdims=True)
        P = np.exp(Z)
        P /= P.sum(axis=1, keepdims=True)
        G = (P - Y) * sw[:, None] / n
        gW = Xn.T @ G + l2 * W
        gb = G.sum(axis=0)
        for p, g, m, v in ((W, gW, mW, vW), (b, gb, mb, vb)):
            m *= b1
            m += (1 - b1) * g
            v *= b2
            v += (1 - b2) * g * g
            p -= lr * (m / (1 - b1**t)) / (np.sqrt(v / (1 - b2**t)) + eps)

    model = Model(mean=mean, std=std, W=W, b=b, metrics={})
    Xe, ye = _dataset(EVAL_SEEDS, (40, 60))
    cm = _confusion(ye, model.predict_proba(Xe).argmax(axis=1), K)
    model.metrics = {
        "train_samples": int(n),
        "eval_samples": int(len(ye)),
        "eval_fields": len(EVAL_SEEDS),
        **_metrics(cm),
    }
    return model


@lru_cache(maxsize=1)
def get_model() -> Model:
    return train()


# --------------------------------------------------------------------------- #
# Inference + fusion
# --------------------------------------------------------------------------- #
def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-5, 1 - 1e-5)
    return np.log(p / (1 - p))


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-z))


def trap_pressure_surface(field_id: str, day: int, overrides: dict[str, float] | None = None) -> tuple[np.ndarray, list[dict]]:
    """Inverse-distance-weighted trap counts across the grid, as a ratio to the economic threshold.

    ``overrides`` maps station id -> recent daily mean from live (ingested)
    readings; those replace the simulated history for that trap.
    """
    overrides = overrides or {}
    f = FIELDS_BY_ID[field_id]
    hist = sensor_history(field_id, day)
    traps = [s for s in hist["stations"] if s.kind == "trap"]
    yy, xx = np.mgrid[0 : f.rows, 0 : f.cols]
    num = np.zeros((f.rows, f.cols))
    den = np.zeros((f.rows, f.cols))
    info = []
    for s in traps:
        counts = hist["series"][s.id]["trap_count"][::8]
        live = s.id in overrides
        recent = float(overrides[s.id]) if live else float(np.mean(counts[-3:]))
        ratio = recent / TRAP_ECONOMIC_THRESHOLD
        d2 = (yy + 0.5 - s.row) ** 2 + (xx + 0.5 - s.col) ** 2
        w = 1.0 / (d2 + 9.0)
        num += w * ratio
        den += w
        info.append({"station_id": s.id, "row": s.row, "col": s.col, "recent_daily_mean": round(recent, 1), "threshold_ratio": round(ratio, 2), "source": "live" if live else "simulated"})
    return num / den, info


@dataclass
class Detection:
    field_id: str
    day: int
    proba: np.ndarray  # (rows, cols, K) fused, cropped cells only meaningful
    image_proba: np.ndarray  # before fusion
    classes: np.ndarray  # argmax class per cell
    hotspots: list[dict]
    sensor_context: dict


def detect(field_id: str, day: int, *, fuse_sensors: bool = True, trap_overrides: dict[str, float] | None = None) -> Detection:
    f = FIELDS_BY_ID[field_id]
    s = simulate_survey(field_id, day)
    model = get_model()
    cube = extract_features(s)
    P = model.predict_proba(cube.reshape(-1, cube.shape[-1])).reshape(f.rows, f.cols, len(CLASSES))
    # Spatial smoothing of probabilities suppresses single-pixel noise.
    P = np.stack([box_blur(P[..., k], 1) * 0.5 + P[..., k] * 0.5 for k in range(len(CLASSES))], axis=-1)
    image_P = P.copy()

    hist = sensor_history(field_id, day)
    risk = disease_risk_index(hist)
    trap_surface, trap_info = trap_pressure_surface(field_id, day, trap_overrides)
    if fuse_sensors:
        # log(ratio) is 0 at threshold; strong catches push pest odds up, empty traps down.
        pest_adj = 0.9 * np.clip(np.log(np.maximum(trap_surface, 0.05)), -2.0, 1.5)
        dis_adj = 1.6 * (risk - 0.5)
        threat = np.stack(
            [
                _sigmoid(_logit(P[..., 1])),
                _sigmoid(_logit(P[..., 2]) + pest_adj),
                _sigmoid(_logit(P[..., 3]) + dis_adj),
            ],
            axis=-1,
        )
        healthy = np.clip(1 - threat.max(axis=-1), 0, 1)
        P = np.concatenate([healthy[..., None], threat], axis=-1)
    P = np.where(s.cropped[..., None], P, np.array([1.0, 0, 0, 0]))
    classes = np.where(P[..., 1:].max(axis=-1) >= 0.5, P[..., 1:].argmax(axis=-1) + 1, 0)

    hotspots = _hotspots(field_id, P, classes)
    return Detection(
        field_id=field_id,
        day=day,
        proba=P,
        image_proba=image_P,
        classes=classes,
        hotspots=hotspots,
        sensor_context={
            "disease_risk_index": round(risk, 3),
            "traps": trap_info,
            "trap_economic_threshold": TRAP_ECONOMIC_THRESHOLD,
            "fusion_enabled": fuse_sensors,
        },
    )


def _hotspots(field_id: str, P: np.ndarray, classes: np.ndarray, min_cells: int = 2) -> list[dict]:
    f = FIELDS_BY_ID[field_id]
    g = f.grid
    out = []
    for k in range(1, len(CLASSES)):
        labels, n = connected_components(classes == k)
        for lab in range(1, n + 1):
            cells = np.argwhere(labels == lab)
            if len(cells) < min_cells:
                continue
            conf = P[cells[:, 0], cells[:, 1], k]
            r, c = cells.mean(axis=0)
            lat, lon = g.cell_center_latlon(r, c)
            area_m2 = len(cells) * f.cell_m**2
            mean_conf = float(conf.mean())
            severity = "high" if mean_conf > 0.85 and len(cells) >= 8 else "medium" if mean_conf > 0.7 else "low"
            out.append(
                {
                    "id": f"{field_id}-{CLASSES[k]}-{lab}",
                    "class": CLASSES[k],
                    "cells": int(len(cells)),
                    "area_m2": float(area_m2),
                    "centroid": {"row": round(float(r), 2), "col": round(float(c), 2), "lat": round(lat, 6), "lon": round(lon, 6)},
                    "bbox": {
                        "row_min": int(cells[:, 0].min()),
                        "row_max": int(cells[:, 0].max()),
                        "col_min": int(cells[:, 1].min()),
                        "col_max": int(cells[:, 1].max()),
                    },
                    "confidence": round(mean_conf, 3),
                    "severity": severity,
                }
            )
    out.sort(key=lambda h: (-h["area_m2"] * h["confidence"]))
    return out


def evaluate_field(field_id: str, day: int) -> dict:
    """Score a detection against the simulator's ground truth (demo transparency)."""
    det = detect(field_id, day)
    s = simulate_survey(field_id, day)
    cm = _confusion(s.truth[s.cropped].astype(int), det.classes[s.cropped].astype(int), len(CLASSES))
    return _metrics(cm)
