import { Check, Download, Plane, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FieldMap, GradientLegend, Legend } from "../components/FieldMap";
import { Bar, Button, ErrorBox, Kpi, Loading, Pill, Sheet } from "../components/ui";
import { api, type Detections, type Prescription, type Survey, type ThreatClass } from "../lib/api";
import { CLASS_COLOR, CLASS_LABEL, hexToRgb, PRODUCT_COLOR, rgb, sprayRamp, thermalRamp, vegRamp } from "../lib/colors";
import { fmt, seasonDate } from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useSeason } from "../lib/season";

type Layer = "ndvi" | "ndre" | "thermal" | "threat" | "classes" | "prescription";

const LAYERS: { id: Layer; label: string; hint: string }[] = [
  { id: "ndvi", label: "NDVI", hint: "Canopy vigour from NIR and red reflectance" },
  { id: "ndre", label: "Red-edge", hint: "NDRE: chlorophyll stress, sensitive to early disease" },
  { id: "thermal", label: "Thermal", hint: "Canopy temperature: stressed plants transpire less and run hot" },
  { id: "threat", label: "Threat probability", hint: "Highest fused threat probability per cell" },
  { id: "classes", label: "Detections", hint: "Cells the model classifies as weed, pest or disease" },
  { id: "prescription", label: "Prescription", hint: "Total product rate per cell (L/ha)" },
];

const CLS = ["healthy", "weed", "pest", "disease"] as const;

function cellColorFn(layer: Layer, s: Survey, d: Detections | undefined, rx: Prescription | undefined) {
  const tRange = (() => {
    const v = s.layers.thermal_c.flat().filter((_, i) => s.cropped.flat()[i]);
    return [Math.min(...v), Math.max(...v)];
  })();
  return (r: number, c: number): string | null => {
    if (!s.cropped[r][c]) return null;
    switch (layer) {
      case "ndvi":
        return rgb(vegRamp((s.layers.ndvi[r][c] - 0.4) / 0.5));
      case "ndre":
        return rgb(vegRamp((s.layers.ndre[r][c] - 0.1) / 0.25));
      case "thermal":
        return rgb(thermalRamp((s.layers.thermal_c[r][c] - tRange[0]) / (tRange[1] - tRange[0] || 1)));
      case "threat": {
        if (!d) return "#ddd5c0";
        let best: ThreatClass = "weed";
        let p = 0;
        for (const k of ["weed", "pest", "disease"] as ThreatClass[]) {
          if (d.probabilities[k][r][c] > p) {
            p = d.probabilities[k][r][c];
            best = k;
          }
        }
        const base = hexToRgb(CLASS_COLOR[best]);
        const paper: [number, number, number] = [236, 232, 218];
        const t = Math.min(1, p * 1.1);
        return rgb([0, 1, 2].map((i) => Math.round(paper[i] + (base[i] - paper[i]) * t)) as [number, number, number]);
      }
      case "classes": {
        const k = d?.class_map[r][c] ?? 0;
        if (k) return CLASS_COLOR[CLS[k] as ThreatClass];
        return rgb(vegRamp((s.layers.ndvi[r][c] - 0.4) / 0.5), 0.35);
      }
      case "prescription": {
        if (!rx) return "#ddd5c0";
        const total = rx.rates.herbicide[r][c] + rx.rates.insecticide[r][c] + rx.rates.fungicide[r][c];
        if (total <= 0) return "#f4f1e8";
        return rgb(sprayRamp(Math.min(1, 0.25 + total / 3)));
      }
    }
  };
}

export default function FieldWorkspace() {
  const { fieldId = "north-40" } = useParams();
  const { day } = useSeason();
  const [layer, setLayer] = useState<Layer>("classes");
  const [fuse, setFuse] = useState(true);
  const [threshold, setThreshold] = useState(0.5);
  const [buffer, setBuffer] = useState(1);
  const [minPatch, setMinPatch] = useState(2);
  const [noSprayBuffer, setNoSprayBuffer] = useState(true);
  const [show, setShow] = useState({ hotspots: true, sensors: true, path: false, buffer: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; status: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // A saved draft belongs to one field/day/rule set; any change starts a new one.
  useEffect(() => setSaved(null), [fieldId, day, fuse, threshold, buffer, minPatch, noSprayBuffer]);

  const params = useDebounced({ threshold, buffer, minPatch, noSprayBuffer }, 200);

  const field = useAsync(() => api.field(fieldId), [fieldId]);
  const survey = useAsync(() => api.survey(fieldId, day), [fieldId, day]);
  const det = useAsync(() => api.detections(fieldId, day, fuse), [fieldId, day, fuse]);
  const rx = useAsync(
    () =>
      api.prescription(fieldId, {
        day,
        fuse_sensors: fuse,
        threshold: params.threshold,
        buffer_cells: params.buffer,
        min_patch_cells: params.minPatch,
        no_spray_buffer: params.noSprayBuffer,
      }),
    [fieldId, day, fuse, params],
  );
  const sensors = useAsync(() => api.sensors(fieldId, day), [fieldId, day]);
  const evaluation = useAsync(() => api.evaluation(fieldId, day), [fieldId, day]);

  const colorFn = useMemo(
    () => (survey.data ? cellColorFn(layer, survey.data, det.data, rx.data) : null),
    [layer, survey.data, det.data, rx.data],
  );

  if (field.error || survey.error) return <ErrorBox error={(field.error ?? survey.error)!} onRetry={() => (field.reload(), survey.reload())} />;
  if (!field.data || !survey.data || !colorFn) return <Loading label="Loading field" />;

  const f = field.data;
  const s = survey.data;
  const r = rx.data;
  const sum = r?.summary;

  const describe = (row: number, col: number) => (
    <div className="space-y-0.5">
      {!s.cropped[row][col] ? (
        <div>Not cropped</div>
      ) : (
        <>
          <div className="flex justify-between gap-4">
            <span>NDVI</span>
            <span className="num">{s.layers.ndvi[row][col].toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Canopy</span>
            <span className="num">{s.layers.thermal_c[row][col].toFixed(1)} °C</span>
          </div>
          {det.data &&
            (["weed", "pest", "disease"] as ThreatClass[]).map((k) => (
              <div key={k} className="flex justify-between gap-4">
                <span style={{ color: CLASS_COLOR[k] }}>{k}</span>
                <span className="num">{fmt.frac(det.data!.probabilities[k][row][col])}</span>
              </div>
            ))}
          {r && (
            <div className="mt-1 border-t border-white/15 pt-1">
              {(["herbicide", "insecticide", "fungicide"] as const)
                .filter((k) => r.rates[k][row][col] > 0)
                .map((k) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span>{k}</span>
                    <span className="num">{r.rates[k][row][col].toFixed(2)} L/ha</span>
                  </div>
                ))}
              {s.no_spray[row][col] ? <div className="text-[#9fd3dc]">No-spray buffer</div> : null}
            </div>
          )}
        </>
      )}
    </div>
  );

  async function save() {
    setSaving(true);
    try {
      const res = await api.prescription(fieldId, {
        day,
        fuse_sensors: fuse,
        threshold,
        buffer_cells: buffer,
        min_patch_cells: minPatch,
        no_spray_buffer: noSprayBuffer,
        save: true,
      });
      setSaved({ id: res.id!, status: res.status! });
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!saved) return;
    const res = await api.setStatus(saved.id, "approved");
    setSaved({ id: res.id, status: res.status });
  }

  const wx = sensors.data?.stations.find((x) => x.kind === "weather");
  const wxData =
    wx && sensors.data
      ? sensors.data.timestamps.map((t, i) => ({ t, temp: wx.series.air_temp_c[i], wet: wx.series.leaf_wetness[i] * 100, hum: wx.series.humidity_pct[i] }))
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">
            <Link to="/app" className="hover:underline">
              Overview
            </Link>{" "}
            / {f.crop} · {f.variety}
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">{f.name}</h1>
          <p className="mt-1 text-sm text-ink-3">
            {f.grid.rows}×{f.grid.cols} cells of {f.grid.cell_m} m · drone pass {fmt.datetime(s.captured_at)} · {s.sensor}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fuse} onChange={(e) => setFuse(e.target.checked)} className="h-4 w-4 accent-moss" />
          Fuse ground-sensor evidence
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="moss" label="Area to treat" value={sum ? fmt.frac(sum.treated_fraction) : "—"} sub={sum ? `${fmt.num(sum.treated_ha, 2)} of ${fmt.num(sum.cropped_ha, 2)} ha` : ""} />
        <Kpi tone="lime" label="Chemical vs blanket" value={sum ? `−${fmt.pct(sum.chemical_reduction_pct)}` : "—"} sub={sum ? `${fmt.litres(sum.volume_l)} vs ${fmt.litres(sum.blanket_volume_l)}` : ""} />
        <Kpi label="Input cost" value={sum ? fmt.usd(sum.cost) : "—"} sub={sum ? `${fmt.usd(sum.cost_saving)} saved` : ""} />
        <Kpi tone="spray" label="Drone time" value={r ? `${fmt.num(r.mission.total_time_min, 0)} min` : "—"} sub={r ? `blanket: ${fmt.num(r.mission.blanket_total_time_min, 0)} min` : ""} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Sheet
          className="self-start"
          label={`Fig. 02 · ${seasonDate(day)}`}
          title={LAYERS.find((l) => l.id === layer)!.label}
          aside={
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Map layer">
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  role="tab"
                  aria-selected={layer === l.id}
                  title={l.hint}
                  onClick={() => setLayer(l.id)}
                  className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${layer === l.id ? "bg-ink text-paper" : "bg-paper-2 hover:bg-paper-3"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          }
        >
          <FieldMap
            rows={f.grid.rows}
            cols={f.grid.cols}
            cellM={f.grid.cell_m}
            cellColor={colorFn}
            version={colorFn}
            noSpray={show.buffer ? s.no_spray : undefined}
            hotspots={show.hotspots ? det.data?.hotspots : undefined}
            highlight={selected}
            stations={show.sensors ? f.stations : undefined}
            waypoints={show.path ? r?.mission.waypoints : undefined}
            describe={describe}
            ariaLabel={`${f.name} ${layer} map`}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            {layer === "ndvi" || layer === "ndre" || layer === "classes" ? (
              layer === "classes" ? (
                <Legend items={(["weed", "pest", "disease"] as ThreatClass[]).map((k) => ({ color: CLASS_COLOR[k], label: CLASS_LABEL[k] }))} />
              ) : (
                <GradientLegend from="low" to="high" stops={["#8b5e3c", "#d6c48c", "#8ab05c", "#1e4a2c"]} unit={layer.toUpperCase()} />
              )
            ) : layer === "thermal" ? (
              <GradientLegend from="cool" to="hot" stops={["#345c78", "#ece6d6", "#c4452d"]} unit="canopy °C" />
            ) : layer === "threat" ? (
              <GradientLegend from="0%" to="100%" stops={["#ece8da", "#c4452d"]} unit="max threat probability (hue = class)" />
            ) : (
              <GradientLegend from="0" to="3+" stops={["#deeeec", "#115c6c"]} unit="L/ha, all products" />
            )}
            <div className="flex flex-wrap gap-3 text-xs">
              {(
                [
                  ["hotspots", "Hotspots"],
                  ["sensors", "Sensors"],
                  ["path", "Flight path"],
                  ["buffer", "No-spray buffer"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" className="accent-moss" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {show.sensors && (
            <div className="mt-3">
              <Legend
                items={[
                  { color: "#fbf9f3", label: "Pheromone trap", shape: "tri" },
                  { color: "#cfe34b", label: "Weather station", shape: "dot" },
                  { color: "#8a6a44", label: "Soil probe", shape: "sq" },
                  { color: "", label: "No-spray (watercourse) buffer", hatch: true },
                ]}
              />
            </div>
          )}
        </Sheet>

        <div className="space-y-5">
          <Sheet label="Prescription rules" title="Agronomist controls">
            <div className="space-y-4 text-sm">
              <div>
                <div className="flex justify-between">
                  <label htmlFor="thr">Action threshold</label>
                  <span className="num">{fmt.frac(threshold)}</span>
                </div>
                <input id="thr" type="range" min={0.3} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="w-full" />
                <p className="text-xs text-ink-3">Lower catches more, sprays more.</p>
              </div>
              <div>
                <div className="flex justify-between">
                  <label htmlFor="buf">Edge buffer</label>
                  <span className="num">{buffer * f.grid.cell_m} m</span>
                </div>
                <input id="buf" type="range" min={0} max={3} step={1} value={buffer} onChange={(e) => setBuffer(+e.target.value)} className="w-full" />
              </div>
              <div>
                <div className="flex justify-between">
                  <label htmlFor="mp">Minimum patch</label>
                  <span className="num">{minPatch} cells</span>
                </div>
                <input id="mp" type="range" min={1} max={8} step={1} value={minPatch} onChange={(e) => setMinPatch(+e.target.value)} className="w-full" />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-moss" checked={noSprayBuffer} onChange={(e) => setNoSprayBuffer(e.target.checked)} />
                Enforce watercourse no-spray buffer
              </label>
              {!noSprayBuffer && f.water_edge && <p className="text-xs text-pest">Turning this off is for comparison only. Check local buffer-zone rules.</p>}
            </div>
          </Sheet>

          <Sheet label="Per product" title="Applied vs blanket" aside={rx.loading ? <span className="label">…</span> : null}>
            {sum ? (
              <div className="space-y-4">
                {sum.products.map((p) => (
                  <div key={p.key}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium" style={{ color: PRODUCT_COLOR[p.key] }}>
                        {p.name}
                      </span>
                      <span className="num text-xs">
                        {fmt.litres(p.volume_l)} / {fmt.litres(p.blanket_volume_l)}
                      </span>
                    </div>
                    <Bar value={p.volume_l} max={Math.max(p.blanket_volume_l, 0.001)} color={PRODUCT_COLOR[p.key]} />
                    <div className="mt-1 text-xs text-ink-3">
                      {p.needed ? `${p.treated_cells} cells · ${p.active_ingredient} · label ${p.label_rate_l_ha} L/ha` : "Not needed this pass"}
                      {p.excluded_by_buffer_cells ? ` · ${p.excluded_by_buffer_cells} target cells inside buffer` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Loading />
            )}
          </Sheet>

          <Sheet label="Drone mission" title="Spot-spray flight">
            {r ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Spray segments", fmt.int(r.mission.segments)],
                    ["Tank mix", fmt.litres(r.mission.tank_mix_l)],
                    ["Refills", fmt.int(r.mission.tank_refills)],
                    ["Battery sets", fmt.int(r.mission.battery_sets)],
                    ["Spraying", `${fmt.num(r.mission.spray_distance_m / 1000, 2)} km`],
                    ["Transit", `${fmt.num(r.mission.transit_distance_m / 1000, 2)} km`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="label">{k}</div>
                      <div className="num">{v}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ink-3">
                  {r.mission.drone.name}, {r.mission.drone.swath_m} m swath. {fmt.pct(r.mission.time_saving_pct)} less time than a full-field pass.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="ghost" onClick={() => setShow({ ...show, path: !show.path })}>
                    <Plane size={14} /> {show.path ? "Hide" : "Show"} path
                  </Button>
                  {!saved ? (
                    <Button onClick={save} disabled={saving}>
                      <Save size={14} /> {saving ? "Saving…" : "Save draft"}
                    </Button>
                  ) : saved.status !== "approved" ? (
                    <Button variant="lime" onClick={approve}>
                      <Check size={14} /> Approve for flight
                    </Button>
                  ) : (
                    <Pill color="#2e5b3b">approved · {saved.id}</Pill>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 pt-1 text-xs">
                  <a
                    className="inline-flex items-center gap-1 underline"
                    href={
                      saved
                        ? `/api/prescriptions/${saved.id}/geojson`
                        : `/api/fields/${fieldId}/prescription.geojson?day=${day}&threshold=${threshold}&buffer_cells=${buffer}&min_patch_cells=${minPatch}&no_spray_buffer=${noSprayBuffer}&fuse_sensors=${fuse}`
                    }
                  >
                    <Download size={12} /> GeoJSON
                  </a>
                  {saved && (
                    <a className="inline-flex items-center gap-1 underline" href={`/api/prescriptions/${saved.id}/csv`}>
                      <Download size={12} /> CSV
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <Loading />
            )}
          </Sheet>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Sheet label="AI detections" title={`${det.data?.hotspots.length ?? "…"} hotspots`} pad={false}>
          {det.data ? (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#fbf9f3]">
                  <tr className="label border-b border-line">
                    <th className="px-5 py-2 font-normal">Threat</th>
                    <th className="px-2 py-2 font-normal">Area</th>
                    <th className="px-2 py-2 font-normal">Confidence</th>
                    <th className="px-2 py-2 font-normal">Severity</th>
                    <th className="px-5 py-2 font-normal">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {det.data.hotspots.map((h) => (
                    <tr
                      key={h.id}
                      tabIndex={0}
                      onMouseEnter={() => setSelected(h.id)}
                      onFocus={() => setSelected(h.id)}
                      onMouseLeave={() => setSelected(null)}
                      className={`cursor-default border-b border-line/60 ${selected === h.id ? "bg-paper-2" : ""}`}
                    >
                      <td className="px-5 py-2">
                        <span className="mr-2 inline-block h-2.5 w-2.5" style={{ background: CLASS_COLOR[h.class] }} />
                        {CLASS_LABEL[h.class]}
                      </td>
                      <td className="num px-2 py-2">{fmt.int(h.area_m2)} m²</td>
                      <td className="num px-2 py-2">{fmt.frac(h.confidence)}</td>
                      <td className="px-2 py-2">
                        <Pill color={h.severity === "high" ? "#c4452d" : h.severity === "medium" ? "#d49a1e" : undefined}>{h.severity}</Pill>
                      </td>
                      <td className="num px-5 py-2 text-xs text-ink-3">
                        {h.centroid.lat.toFixed(5)}, {h.centroid.lon.toFixed(5)}
                      </td>
                    </tr>
                  ))}
                  {!det.data.hotspots.length && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-ink-3">
                        No hotspots on this day. Nothing to spray.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <Loading />
            </div>
          )}
          {evaluation.data && (
            <div className="border-t border-line px-5 py-3 text-xs text-ink-3">
              Scored against the simulator's hidden ground truth: accuracy <span className="num text-ink">{fmt.frac(evaluation.data.accuracy, 1)}</span>,
              threat detection <span className="num text-ink">{fmt.frac(evaluation.data.threat_detection_rate, 1)}</span>, false-spray rate{" "}
              <span className="num text-ink">{fmt.frac(evaluation.data.false_spray_rate, 1)}</span>. Buffers cover much of the missed edge cells.
            </div>
          )}
        </Sheet>

        <Sheet label="Ground truth from sensors" title="Traps & weather">
          {sensors.data ? (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="label">Moth catch, last 3 days (per trap / day)</span>
                  <span className="num text-xs text-ink-3">threshold {sensors.data.trap_economic_threshold}</span>
                </div>
                <div className="space-y-2">
                  {sensors.data.traps.map((t) => (
                    <div key={t.station_id} className="grid grid-cols-[88px_1fr_44px] items-center gap-2 text-xs">
                      <span className="num truncate">
                        {t.station_id.split("-").slice(-2).join(" ")}
                        {t.source === "live" && <span className="ml-1 text-spray">●</span>}
                      </span>
                      <Bar
                        value={t.recent_daily_mean}
                        max={Math.max(40, sensors.data!.trap_economic_threshold * 2)}
                        color={t.threshold_ratio >= 1 ? "#c4452d" : "#2e5b3b"}
                        marker={sensors.data!.trap_economic_threshold}
                      />
                      <span className="num text-right">{t.recent_daily_mean}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="label">Disease risk (leaf wetness model)</span>
                  <span className="num text-sm">{fmt.frac(sensors.data.disease_risk_index)}</span>
                </div>
                <Bar value={sensors.data.disease_risk_index} max={1} color="#7b5aa6" />
              </div>
              <div className="h-40">
                <ResponsiveContainer>
                  <LineChart data={wxData} margin={{ left: -24, right: 4, top: 4 }}>
                    <CartesianGrid stroke="#cfc6ae" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="t" tickFormatter={(t) => fmt.date(t)} tick={{ fontSize: 10 }} minTickGap={40} stroke="#5b675d" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#5b675d" />
                    <Tooltip
                      labelFormatter={(t) => fmt.datetime(String(t))}
                      contentStyle={{ background: "#17241c", border: 0, color: "#f2eee3", fontSize: 12 }}
                      formatter={(v: number, n) => [n === "wet" ? `${v.toFixed(0)}%` : `${v.toFixed(1)} °C`, n === "wet" ? "Leaf wetness" : "Air temp"]}
                    />
                    <Line dataKey="temp" stroke="#c4452d" dot={false} strokeWidth={1.5} />
                    <Line dataKey="wet" stroke="#1f7a8c" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <Legend
                items={[
                  { color: "#c4452d", label: "Air temp °C" },
                  { color: "#1f7a8c", label: "Leaf wetness %" },
                ]}
              />
              <Link to="/app/telemetry" className="text-xs underline">
                Push a live reading →
              </Link>
            </div>
          ) : (
            <Loading />
          )}
        </Sheet>
      </div>
    </div>
  );
}
