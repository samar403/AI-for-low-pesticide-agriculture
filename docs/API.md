# API reference

Interactive OpenAPI docs are served at `http://localhost:8000/docs`. All endpoints are JSON unless noted. `day` is the season day (5–90, default 55).

## Farm & fields
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | `{status, version}` |
| GET | `/api/farm?day=` | Field cards plus farm totals (treated ha, litres vs blanket, cost, EIQ, hotspots) |
| GET | `/api/fields?day=` | Field cards |
| GET | `/api/fields/{id}` | Grid spec, boundary polygon (GeoJSON), stations |
| GET | `/api/fields/{id}/survey?day=` | Per-cell NDVI, NDRE, GNDVI, thermal, texture, cropped and no-spray masks |
| GET | `/api/fields/{id}/detections?day=&fuse=true` | Class map, per-class probability grids, hotspots, sensor context |
| GET | `/api/fields/{id}/evaluation?day=` | Accuracy against simulator ground truth |

## Prescriptions
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/fields/{id}/prescriptions` | Body: `day, threshold, buffer_cells, min_patch_cells, buffer_rate_fraction, no_spray_buffer, fuse_sensors, save, note`. Returns summary, per-product rate grids and mission. With `save: true` it is stored as a draft and returns its `id`. |
| GET | `/api/fields/{id}/prescription.geojson?...` | Unsaved preview as GeoJSON (same query parameters) |
| GET | `/api/prescriptions[?field_id=]` | Saved prescriptions, without the rate grids |
| GET | `/api/prescriptions/{rx_id}` | Full record |
| POST | `/api/prescriptions/{rx_id}/status` | `{status: draft\|approved\|flown\|archived}` |
| GET | `/api/prescriptions/{rx_id}/geojson` | FeatureCollection of cells, properties `herbicide_l_ha`, `insecticide_l_ha`, `fungicide_l_ha` |
| GET | `/api/prescriptions/{rx_id}/csv` | `row,col,lat,lon,<product>_l_ha...` |
| GET | `/api/products` | Product catalogue (label rate, price, EIQ) |

## Sensors
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/fields/{id}/sensors?day=` | 14-day 3-hourly series per station, trap summary, disease-risk index, live readings |
| POST | `/api/telemetry` | `{readings: [{station_id, metric, value, ts?}]}`, returns `202 {accepted, rejected[]}`. Stations and metrics are validated (a trap can't report `air_temp_c`). |
| GET | `/api/telemetry[?field_id=&limit=]` | Most recent ingested readings |

Metrics: `air_temp_c`, `humidity_pct`, `leaf_wetness`, `rain_mm` (weather), `soil_moisture_pct`, `soil_temp_c` (soil), `trap_count` (trap).

```bash
curl -X POST localhost:8000/api/telemetry -H 'Content-Type: application/json' \
  -d '{"readings":[{"station_id":"mesa-block-trap-1","metric":"trap_count","value":42}]}'
```

## Analytics, model, vision
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/analytics/season?day=` | Weekly timeline and cumulative savings, overall and per field |
| GET | `/api/model` | Model card: classes, features, weights, held-out metrics |
| POST | `/api/vision/analyze?grid=12` | multipart `file`, returns cover fractions, row detection, spray cells and an overlay PNG (data URL) |
| GET | `/api/vision/sample.png?seed=` | Synthetic top-down crop-row photo |
