// Typed client for the Patchwork API. All paths are relative so the Vite proxy
// (dev) and the FastAPI static mount (prod) both work without configuration.

export type ThreatClass = "weed" | "pest" | "disease";
export type Grid = number[][];

export interface FieldCard {
  id: string;
  name: string;
  crop: string;
  variety: string;
  area_ha: number;
  centroid: { lat: number; lon: number };
  mean_ndvi: number;
  hotspots: Record<ThreatClass, number>;
  hotspot_total: number;
  treated_fraction: number;
  chemical_reduction_pct: number;
  cost_saving: number;
  last_survey: string;
}

export interface Farm {
  name: string;
  region: string;
  season_day: number;
  date: string;
  fields: FieldCard[];
  totals: {
    cropped_ha: number;
    treated_ha: number;
    volume_l: number;
    blanket_volume_l: number;
    chemical_reduction_pct: number;
    cost: number;
    blanket_cost: number;
    cost_saving: number;
    eiq_load: number;
    blanket_eiq_load: number;
    hotspots: number;
  };
}

export interface Station {
  id: string;
  kind: "trap" | "weather" | "soil";
  row: number;
  col: number;
}

export interface FieldDetail {
  id: string;
  name: string;
  crop: string;
  variety: string;
  grid: { rows: number; cols: number; cell_m: number; origin: { lat: number; lon: number } };
  boundary: { type: "Polygon"; coordinates: number[][][] };
  water_edge: string | null;
  stations: Station[];
}

export interface Survey {
  field_id: string;
  day: number;
  captured_at: string;
  sensor: string;
  layers: { ndvi: Grid; ndre: Grid; gndvi: Grid; thermal_c: Grid; texture: Grid };
  cropped: Grid;
  no_spray: Grid;
  stats: { mean_ndvi: number; p10_ndvi: number; mean_canopy_temp_c: number };
}

export interface Hotspot {
  id: string;
  class: ThreatClass;
  cells: number;
  area_m2: number;
  centroid: { row: number; col: number; lat: number; lon: number };
  bbox: { row_min: number; row_max: number; col_min: number; col_max: number };
  confidence: number;
  severity: "low" | "medium" | "high";
}

export interface TrapInfo {
  station_id: string;
  row: number;
  col: number;
  recent_daily_mean: number;
  threshold_ratio: number;
  source: "live" | "simulated";
}

export interface Detections {
  field_id: string;
  day: number;
  classes: string[];
  class_map: Grid;
  probabilities: Record<ThreatClass, Grid>;
  hotspots: Hotspot[];
  sensor_context: {
    disease_risk_index: number;
    traps: TrapInfo[];
    trap_economic_threshold: number;
    fusion_enabled: boolean;
  };
}

export interface ProductLine {
  key: "herbicide" | "insecticide" | "fungicide";
  target: ThreatClass;
  name: string;
  active_ingredient: string;
  label_rate_l_ha: number;
  price_per_l: number;
  eiq: number;
  needed: boolean;
  treated_cells: number;
  treated_ha: number;
  volume_l: number;
  blanket_volume_l: number;
  cost: number;
  blanket_cost: number;
  eiq_load: number;
  blanket_eiq_load: number;
  excluded_by_buffer_cells: number;
}

export interface RxSummary {
  cropped_ha: number;
  treated_ha: number;
  treated_fraction: number;
  volume_l: number;
  blanket_volume_l: number;
  cost: number;
  blanket_cost: number;
  eiq_load: number;
  blanket_eiq_load: number;
  active_ingredient_kg: number;
  blanket_active_ingredient_kg: number;
  chemical_reduction_pct: number;
  cost_saving: number;
  eiq_reduction_pct: number;
  tank_mix_l: number;
  blanket_tank_mix_l: number;
  products: ProductLine[];
  no_spray_cells: number;
}

export interface Mission {
  drone: { name: string; tank_l: number; swath_m: number; spray_speed_ms: number };
  segments: number;
  spray_distance_m: number;
  transit_distance_m: number;
  flight_time_min: number;
  total_time_min: number;
  tank_mix_l: number;
  tank_refills: number;
  battery_sets: number;
  blanket_total_time_min: number;
  time_saving_pct: number;
  waypoints?: { lat: number; lon: number; x_m: number; y_m: number; spray: boolean }[];
}

export interface RxParams {
  threshold: number;
  buffer_cells: number;
  min_patch_cells: number;
  buffer_rate_fraction: number;
  no_spray_buffer: boolean;
}

export interface Prescription {
  id?: string;
  status?: RxStatus;
  created_at?: string;
  field_id: string;
  day: number;
  params: RxParams;
  summary: RxSummary;
  rates: Record<ProductLine["key"], Grid>;
  mission: Mission;
}

export type RxStatus = "draft" | "approved" | "flown" | "archived";

export interface SavedRx {
  id: string;
  field_id: string;
  day: number;
  status: RxStatus;
  params: RxParams;
  summary: RxSummary;
  mission: Mission;
  note: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface SensorStation extends Station {
  latest: Record<string, number> & { _live?: Record<string, { value: number; ts: string }> };
  series: Record<string, number[]>;
}

export interface Reading {
  station_id: string;
  field_id: string;
  metric: string;
  value: number;
  ts: string;
  received_at: string;
}

export interface Sensors {
  field_id: string;
  timestamps: string[];
  metrics: Record<string, { station_kind: string; unit: string }>;
  stations: SensorStation[];
  disease_risk_index: number;
  traps: TrapInfo[];
  trap_economic_threshold: number;
  live_readings: Reading[];
}

export interface SeasonRow {
  day: number;
  date: string;
  volume_l: number;
  blanket_volume_l: number;
  cost: number;
  blanket_cost: number;
  eiq_load: number;
  blanket_eiq_load: number;
}

export interface Season {
  assumption: string;
  timeline: SeasonRow[];
  by_field: Record<string, (SeasonRow & { treated_fraction: number })[]>;
  cumulative: SeasonRow & { chemical_reduction_pct: number; cost_saving: number; eiq_reduction_pct: number };
}

export interface ClassMetric {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface ModelCard {
  type: string;
  classes: string[];
  features: string[];
  weights: Record<string, Record<string, number>>;
  metrics: {
    train_samples: number;
    eval_samples: number;
    eval_fields: number;
    accuracy: number;
    threat_detection_rate: number;
    false_spray_rate: number;
    confusion_matrix: number[][];
  } & Record<string, ClassMetric | number | number[][]>;
}

export interface Evaluation {
  accuracy: number;
  threat_detection_rate: number;
  false_spray_rate: number;
  confusion_matrix: number[][];
}

export interface VisionResult {
  width: number;
  height: number;
  vegetation_cover: number;
  crop_cover: number;
  weed_cover: number;
  rows_detected: boolean;
  row_orientation: string | null;
  row_spacing_px: number | null;
  row_signal_strength: number;
  grid: { rows: number; cols: number };
  spray_cells: number;
  spray_fraction: number;
  overlay_png: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  farm: (day: number) => request<Farm>(`/api/farm?day=${day}`),
  field: (id: string) => request<FieldDetail>(`/api/fields/${id}`),
  survey: (id: string, day: number) => request<Survey>(`/api/fields/${id}/survey?day=${day}`),
  detections: (id: string, day: number, fuse: boolean) =>
    request<Detections>(`/api/fields/${id}/detections?day=${day}&fuse=${fuse}`),
  evaluation: (id: string, day: number) => request<Evaluation>(`/api/fields/${id}/evaluation?day=${day}`),
  prescription: (id: string, body: Partial<RxParams> & { day: number; fuse_sensors: boolean; save?: boolean; note?: string }) =>
    request<Prescription>(`/api/fields/${id}/prescriptions`, json(body)),
  prescriptions: () => request<SavedRx[]>(`/api/prescriptions`),
  setStatus: (id: string, status: RxStatus) => request<SavedRx>(`/api/prescriptions/${id}/status`, json({ status })),
  sensors: (id: string, day: number) => request<Sensors>(`/api/fields/${id}/sensors?day=${day}`),
  telemetry: (fieldId?: string) => request<Reading[]>(`/api/telemetry${fieldId ? `?field_id=${fieldId}` : ""}`),
  ingest: (readings: { station_id: string; metric: string; value: number; ts?: string }[]) =>
    request<{ accepted: number; rejected: { index: number; reason: string }[] }>(`/api/telemetry`, json({ readings })),
  season: (day: number) => request<Season>(`/api/analytics/season?day=${day}`),
  model: () => request<ModelCard>(`/api/model`),
  analyzeImage: (file: Blob, grid = 12) => {
    const fd = new FormData();
    fd.append("file", file, "upload.png");
    return request<VisionResult>(`/api/vision/analyze?grid=${grid}`, { method: "POST", body: fd });
  },
};

export const DEFAULT_DAY = 55;
