# Architecture

```
 ┌──────────── data sources ────────────┐      ┌──────────────── decision ─────────────────┐      ┌──── action ────┐
 Drone survey (G, R, RE, NIR, LWIR)  ──┐
   2×2 sub-pixels per 10 m cell        │   features   ┌──────────────┐  fused    ┌──────────────┐  rates  ┌────────────┐
                                       ├────────────▶ │  detector    │ ───────▶ │ prescription │ ──────▶ │  mission   │ ──▶ GeoJSON / CSV
 Pheromone traps, weather, soil  ──────┘  log-odds    │ (softmax LR) │  probs   │   engine     │         │  planner   │      waypoints
   simulated history + live ingest ───────adjust────▶ └──────────────┘          └──────────────┘         └────────────┘
                                                                                     ▲ agronomist rules, label caps, no-spray buffers
```

## Backend (`backend/app`)

| Module | Responsibility |
| --- | --- |
| `geo.py` | Grid spec, cell to lat/lon, polygon mask, box blur, dilation, connected components (numpy only) |
| `simulator.py` | Field catalogue, threat patches, survey rendering, ground stations and time series, disease-risk index |
| `detector.py` | Feature cube, model training and evaluation, inference, sensor fusion, hotspot extraction |
| `prescription.py` | Product catalogue, prescription rules, savings and EIQ, GeoJSON/CSV, mission planning |
| `vision_rgb.py` | Training-free weed mapping from RGB photos, plus a synthetic sample image |
| `store.py` | SQLite: `telemetry` and `prescriptions` tables |
| `main.py` | HTTP API, request validation, static web app mount |

### Simulator

Each field has persistent threat patches (weed, pest, disease) with an onset day, growth rate and shape. Weeds are stretched along the crop rows, while pests and disease are rounder. A survey on day *d* renders band reflectances at 2×2 sub-pixels per cell:

- **weeds** add speckled green biomass in the inter-row, which raises NIR texture and local NDVI;
- **insect damage** defoliates, so NIR drops, red rises and the canopy runs hot;
- **fungal disease** depresses red-edge chlorophyll (NDRE) first, with mild warming.

Traps catch in proportion to the peak pest intensity within about 60 m. A wet spell drives leaf wetness. Everything is seeded by field and day.

### Detector

Features per cell are NDVI, NDRE, GNDVI, NDVI and NDRE anomalies against a 13×13 neighbourhood, thermal anomaly against the field median, NIR coefficient of variation inside the cell, and excess-green anomaly. A 4-class softmax regression (Adam, L2, square-root inverse-frequency class weights) trains on 12 synthetic fields × 4 dates, and is evaluated on 4 unseen fields × 2 dates.

Typical held-out results: about 92% accuracy, about 4% false-spray rate, pest and disease recall above 0.9, and weed recall around 0.63. Weeds are the hardest class, and the prescription's edge buffer covers most of the misses.

Fusion: `logit(p_pest) += 0.9·clip(log(trap_ratio), −2, 1.5)` and `logit(p_disease) += 1.6·(risk − 0.5)`. The classes are then treated as independent threat probabilities, with `healthy = 1 − max(threat)`.

### Prescription rules

1. target = cropped cells with p ≥ threshold;
2. drop connected patches smaller than `min_patch_cells`;
3. add `buffer_cells` of edge buffer at `buffer_rate_fraction` × label rate;
4. rate inside target = label × (0.6 + 0.4 × severity), never above label;
5. no-spray and non-cropped cells are always 0.

Outputs include per-product volume, cost, active ingredient and EIQ load (EIQ × AI × volume) next to the blanket baseline.

### Mission planner

A boustrophedon pass over each cell row that contains spray cells, with swath equal to cell width. Contiguous runs become spray-on/off segments. It reports spray and transit distance, flight time, tank refills (40 L tank, 15 L/ha carrier), battery sets, and the time saved against a full-field pass.

## Frontend (`frontend/src`)

- `lib/api.ts` is the typed client. All calls go to relative `/api/...` paths, so the Vite proxy (dev) and the FastAPI static mount (prod) both work.
- `components/FieldMap.tsx` is a canvas renderer for the cell grid with overlays (hotspot boxes, stations, flight path, no-spray hatching), a 100 m scale bar and a hover inspector.
- `lib/season.tsx` holds the season day, which is shared across all dashboard pages through the header slider.
- Pages are lazy-loaded. Charts use Recharts and icons use lucide-react.
- Design tokens live in `index.css` (`@theme`), with the "field notebook" palette and fonts.

## Data model

```sql
telemetry(id, station_id, field_id, metric, value, ts, received_at)
prescriptions(id, field_id, day, status, params JSON, summary JSON, rates JSON, mission JSON, note, created_at, approved_at)
```

Saved prescriptions keep their parameters, so exports are regenerated deterministically from the same inputs.
