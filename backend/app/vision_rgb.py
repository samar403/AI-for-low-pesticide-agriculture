"""Weed mapping from an ordinary RGB photo (phone, scouting drone or boom camera).

Classical, training-free pipeline that is standard in row-crop weed research:

1. Excess-green index (ExG = 2g - r - b on chromatic coordinates) separates
   vegetation from soil, thresholded with Otsu's method.
2. Crop rows are found from the periodicity of the vegetation projection
   profile, testing both image axes and keeping the stronger one.
3. Vegetation inside the crop-row bands is crop; vegetation in the inter-row
   is weed. Weed pixels are aggregated to a coarse grid of spray cells.

This works on a single top-down image with roughly straight rows, which is
how spot-spraying cameras are mounted. Output includes an overlay PNG.
"""
from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image, ImageDraw

from .geo import box_blur

MAX_SIDE = 640


def _otsu(values: np.ndarray, bins: int = 128) -> float:
    hist, edges = np.histogram(values, bins=bins)
    hist = hist.astype(float)
    centers = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * centers) / np.maximum(w0, 1e-9)
    m1 = (np.sum(hist * centers) - np.cumsum(hist * centers)) / np.maximum(w1, 1e-9)
    between = w0 * w1 * (m0 - m1) ** 2
    return float(centers[int(np.argmax(between))])


def _row_axis(veg: np.ndarray) -> tuple[int, float, float, float]:
    """Return (axis, period_px, phase_px, strength). axis=1 means rows run vertically."""
    best = (1, 0.0, 0.0, 0.0)
    for axis in (0, 1):
        profile = veg.mean(axis=axis)  # axis=0 -> profile across columns (vertical rows)
        profile = profile - profile.mean()
        n = profile.size
        spec = np.abs(np.fft.rfft(profile * np.hanning(n)))
        freqs = np.fft.rfftfreq(n)
        valid = (freqs > 1 / (n / 2)) & (freqs < 1 / 6)  # at least 2 rows, period >= 6 px
        if not valid.any():
            continue
        idx = np.flatnonzero(valid)[np.argmax(spec[valid])]
        strength = float(spec[idx] / (spec[valid].mean() + 1e-9))
        if strength > best[3]:
            period = 1 / freqs[idx]
            phase = float(np.angle(np.fft.rfft(profile)[idx]))
            best = (1 if axis == 0 else 0, float(period), phase, strength)
    return best


def analyze_image(data: bytes, grid: int = 12) -> dict:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    scale = min(1.0, MAX_SIDE / max(img.size))
    if scale < 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.BILINEAR)
    a = np.asarray(img).astype(float) / 255.0
    tot = a.sum(axis=-1) + 1e-6
    r, g, b = (a[..., i] / tot for i in range(3))
    exg = 2 * g - r - b
    thr = max(0.05, _otsu(exg))
    veg = exg > thr

    axis, period, phase, strength = _row_axis(veg.astype(float))
    h, w = veg.shape
    rows_found = strength > 3.0 and period > 0
    if rows_found:
        coord = np.arange(w if axis == 1 else h)
        # Cosine of the dominant frequency peaks on the crop-row centrelines.
        wave = np.cos(2 * np.pi * coord / period + phase)
        band = wave > np.cos(np.pi * 0.36)  # ~36% of the period either side of the centreline
        crop_band = np.broadcast_to(band[None, :], (h, w)) if axis == 1 else np.broadcast_to(band[:, None], (h, w))
    else:
        # No row structure (broadcast crop / fallow): treat any vegetation as weed.
        crop_band = np.zeros_like(veg)
    crop = veg & crop_band
    # Opening-like clean-up: keep weed pixels that sit in a dense clump, not leaf-edge fringe.
    weed = veg & ~crop_band
    weed &= box_blur(weed.astype(float), 3) > 0.35
    crop = veg & ~weed

    gh, gw = grid, max(1, round(grid * w / h))
    cells = []
    for i in range(gh):
        for j in range(gw):
            ys, ye = i * h // gh, (i + 1) * h // gh
            xs, xe = j * w // gw, (j + 1) * w // gw
            frac = float(weed[ys:ye, xs:xe].mean()) if ye > ys and xe > xs else 0.0
            cells.append({"row": i, "col": j, "weed_cover": round(frac, 4), "spray": frac > 0.015})

    overlay = (a * 255).astype(np.uint8).copy()
    overlay[crop] = (0.55 * overlay[crop] + 0.45 * np.array([200, 224, 74])).astype(np.uint8)
    overlay[weed] = np.array([214, 72, 40], dtype=np.uint8)
    ov = Image.fromarray(overlay)
    draw = ImageDraw.Draw(ov)
    for cell in cells:
        if cell["spray"]:
            i, j = cell["row"], cell["col"]
            draw.rectangle([j * w // gw, i * h // gh, (j + 1) * w // gw - 1, (i + 1) * h // gh - 1], outline=(255, 240, 200), width=2)
    buf = io.BytesIO()
    ov.save(buf, format="PNG")

    spray_cells = sum(c["spray"] for c in cells)
    return {
        "width": w,
        "height": h,
        "exg_threshold": round(thr, 4),
        "vegetation_cover": round(float(veg.mean()), 4),
        "crop_cover": round(float(crop.mean()), 4),
        "weed_cover": round(float(weed.mean()), 4),
        "rows_detected": bool(rows_found),
        "row_orientation": ("vertical" if axis == 1 else "horizontal") if rows_found else None,
        "row_spacing_px": round(period, 1) if rows_found else None,
        "row_signal_strength": round(strength, 2),
        "grid": {"rows": gh, "cols": gw},
        "cells": cells,
        "spray_cells": int(spray_cells),
        "spray_fraction": round(spray_cells / len(cells), 4),
        "overlay_png": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
    }


def sample_image(seed: int = 7, width: int = 640, height: int = 420) -> bytes:
    """Synthetic top-down photo: soil, four crop rows and scattered weed clumps."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width]
    soil = np.stack([0.42 + 0.05 * rng.random((height, width)), 0.33 + 0.04 * rng.random((height, width)), 0.25 + 0.03 * rng.random((height, width))], axis=-1)
    img = soil.copy()
    period = width / 6
    for k in range(6):
        cx = (k + 0.5) * period + 4 * np.sin(yy / 50 + k)
        leaf = np.abs(xx - cx) < (12 + 6 * np.sin(yy / 9 + k * 1.7)) * (rng.random((height, width)) > 0.15)
        img[leaf] = np.array([0.24, 0.52, 0.18]) + rng.normal(0, 0.03, (int(leaf.sum()), 3))
    for _ in range(26):
        cy, cx = rng.uniform(0, height), rng.uniform(0, width)
        rad = rng.uniform(5, 15)
        clump = ((yy - cy) ** 2 + (xx - cx) ** 2 < rad**2) & (rng.random((height, width)) > 0.35)
        img[clump] = np.array([0.30, 0.60, 0.20]) + rng.normal(0, 0.03, (int(clump.sum()), 3))
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()
