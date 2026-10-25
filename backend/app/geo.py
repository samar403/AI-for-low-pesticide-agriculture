"""Small geometry helpers.

The platform works on a regular grid of square management cells laid over each
field. Grid coordinates are (row, col) with row 0 at the north edge. These
helpers convert between grid cells, local metres and WGS84 lat/lon using an
equirectangular approximation, which is accurate to centimetres at field scale.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

M_PER_DEG_LAT = 111_320.0


@dataclass(frozen=True)
class GridSpec:
    rows: int
    cols: int
    cell_m: float
    origin_lat: float  # north-west corner
    origin_lon: float

    @property
    def m_per_deg_lon(self) -> float:
        return M_PER_DEG_LAT * math.cos(math.radians(self.origin_lat))

    @property
    def cell_area_ha(self) -> float:
        return (self.cell_m * self.cell_m) / 10_000.0

    def local_to_latlon(self, x_m: float, y_m: float) -> tuple[float, float]:
        """x grows east, y grows south from the north-west corner."""
        lat = self.origin_lat - y_m / M_PER_DEG_LAT
        lon = self.origin_lon + x_m / self.m_per_deg_lon
        return lat, lon

    def cell_center_latlon(self, row: float, col: float) -> tuple[float, float]:
        return self.local_to_latlon((col + 0.5) * self.cell_m, (row + 0.5) * self.cell_m)

    def cell_polygon(self, row: int, col: int) -> list[list[float]]:
        """GeoJSON ring ([lon, lat] pairs, closed) for one cell."""
        corners = [(col, row), (col + 1, row), (col + 1, row + 1), (col, row + 1), (col, row)]
        ring = []
        for c, r in corners:
            lat, lon = self.local_to_latlon(c * self.cell_m, r * self.cell_m)
            ring.append([round(lon, 7), round(lat, 7)])
        return ring


def polygon_mask(rows: int, cols: int, polygon: list[tuple[float, float]]) -> np.ndarray:
    """Boolean mask of cells whose centre lies inside a polygon given in (col, row) units."""
    yy, xx = np.mgrid[0:rows, 0:cols]
    px = xx + 0.5
    py = yy + 0.5
    inside = np.zeros((rows, cols), dtype=bool)
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        crosses = ((yi > py) != (yj > py)) & (px < (xj - xi) * (py - yi) / ((yj - yi) or 1e-12) + xi)
        inside ^= crosses
        j = i
    return inside


def box_blur(a: np.ndarray, radius: int) -> np.ndarray:
    """Mean filter with edge padding (separable, via cumulative sums)."""
    if radius <= 0:
        return a.astype(float)
    k = 2 * radius + 1
    p = np.pad(a.astype(float), radius, mode="edge")
    c = np.cumsum(p, axis=0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    v = (c[k:] - c[:-k]) / k
    c = np.cumsum(v, axis=1)
    c = np.hstack([np.zeros((c.shape[0], 1)), c])
    return (c[:, k:] - c[:, :-k]) / k


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Binary dilation with a square structuring element."""
    if radius <= 0:
        return mask.copy()
    return box_blur(mask.astype(float), radius) > 1e-9


def connected_components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected component labelling (iterative flood fill). Returns (labels, count)."""
    labels = np.zeros(mask.shape, dtype=np.int32)
    rows, cols = mask.shape
    current = 0
    for r0 in range(rows):
        for c0 in range(cols):
            if not mask[r0, c0] or labels[r0, c0]:
                continue
            current += 1
            stack = [(r0, c0)]
            labels[r0, c0] = current
            while stack:
                r, c = stack.pop()
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and mask[nr, nc] and not labels[nr, nc]:
                        labels[nr, nc] = current
                        stack.append((nr, nc))
    return labels, current
