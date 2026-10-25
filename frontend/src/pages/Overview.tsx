import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar as RBar, BarChart, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FieldMap } from "../components/FieldMap";
import { ErrorBox, Kpi, Loading, Pill, Sheet } from "../components/ui";
import { api, type FieldCard } from "../lib/api";
import { CLASS_COLOR, rgb, vegRamp } from "../lib/colors";
import { fmt, seasonDate } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSeason } from "../lib/season";

function MiniField({ field, day }: { field: FieldCard; day: number }) {
  const s = useAsync(() => Promise.all([api.survey(field.id, day), api.detections(field.id, day, true)]), [field.id, day]);
  if (!s.data) return <div className="aspect-[3/2] animate-pulse bg-paper-2" />;
  const [survey, det] = s.data;
  const rows = survey.cropped.length;
  const cols = survey.cropped[0].length;
  return (
    <FieldMap
      rows={rows}
      cols={cols}
      cellM={10}
      version={`${field.id}-${day}`}
      ariaLabel={`${field.name} threat map`}
      cellColor={(r, c) => {
        if (!survey.cropped[r][c]) return null;
        const k = det.class_map[r][c];
        if (k) return CLASS_COLOR[(["", "weed", "pest", "disease"] as const)[k] as "weed"];
        return rgb(vegRamp((survey.layers.ndvi[r][c] - 0.5) / 0.4), 0.55);
      }}
    />
  );
}

export default function Overview() {
  const { day } = useSeason();
  const farm = useAsync(() => api.farm(day), [day]);
  const season = useAsync(() => api.season(day), [day]);
  const rx = useAsync(() => api.prescriptions(), []);

  if (farm.error) return <ErrorBox error={farm.error} onRetry={farm.reload} />;
  if (!farm.data) return <Loading label="Surveying the farm" />;
  const { totals: t, fields } = farm.data;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">{farm.data.region}</div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">{farm.data.name}</h1>
          <p className="mt-1 text-sm text-ink-3">
            Latest drone pass {seasonDate(day)} · {fmt.num(t.cropped_ha, 1)} ha across {fields.length} fields · {t.hotspots} hotspots
          </p>
        </div>
        {farm.loading && <span className="label">Updating…</span>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="moss" label="Area needing treatment" value={fmt.frac(t.treated_ha / t.cropped_ha)} sub={`${fmt.num(t.treated_ha)} of ${fmt.num(t.cropped_ha)} ha`} />
        <Kpi tone="lime" label="Chemical vs blanket" value={`−${fmt.pct(t.chemical_reduction_pct)}`} sub={`${fmt.litres(t.volume_l)} instead of ${fmt.litres(t.blanket_volume_l)}`} />
        <Kpi label="Input cost this pass" value={fmt.usd(t.cost)} sub={`${fmt.usd(t.cost_saving)} saved vs ${fmt.usd(t.blanket_cost)}`} />
        <Kpi tone="spray" label="Environmental load (EIQ)" value={fmt.int(t.eiq_load)} sub={`blanket would be ${fmt.int(t.blanket_eiq_load)}`} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {fields.map((f) => (
          <Link key={f.id} to={`/app/fields/${f.id}`} className="group">
            <Sheet
              label={`${f.crop} · ${f.variety}`}
              title={
                <span className="inline-flex items-center gap-1.5">
                  {f.name}
                  <ArrowUpRight size={16} className="opacity-40 transition-opacity group-hover:opacity-100" />
                </span>
              }
              aside={<span className="num text-sm text-ink-3">{fmt.num(f.area_ha)} ha</span>}
              className="transition-shadow group-hover:shadow-[4px_4px_0_#17241c]"
            >
              <MiniField field={f} day={day} />
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="label">Treat</div>
                  <div className="num text-lg">{fmt.frac(f.treated_fraction)}</div>
                </div>
                <div>
                  <div className="label">Chemical saved</div>
                  <div className="num text-lg">{fmt.pct(f.chemical_reduction_pct)}</div>
                </div>
                <div>
                  <div className="label">Mean NDVI</div>
                  <div className="num text-lg">{f.mean_ndvi.toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["weed", "pest", "disease"] as const).map((k) => (
                  <Pill key={k} color={CLASS_COLOR[k]}>
                    {f.hotspots[k]} {k}
                  </Pill>
                ))}
              </div>
            </Sheet>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Sheet label="Season to date · all fields" title="Product applied per weekly pass">
          {season.data ? (
            <>
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={season.data.timeline} margin={{ left: -10, right: 8, top: 8 }}>
                    <CartesianGrid stroke="#cfc6ae" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d) => seasonDate(d)} tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} stroke="#5b675d" />
                    <YAxis tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} stroke="#5b675d" unit=" L" />
                    <Tooltip
                      formatter={(v: number) => fmt.litres(v)}
                      labelFormatter={(d) => `Day ${d} · ${seasonDate(Number(d))}`}
                      contentStyle={{ background: "#17241c", border: 0, color: "#f2eee3", fontSize: 12 }}
                      itemStyle={{ color: "#f2eee3" }}
                    />
                    <RLegend wrapperStyle={{ fontSize: 12 }} />
                    <RBar dataKey="blanket_volume_l" name="Blanket programme" fill="#cfc6ae" />
                    <RBar dataKey="volume_l" name="Patchwork spot-spray" fill="#2e5b3b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-xs text-ink-3">{season.data.assumption}</p>
            </>
          ) : season.error ? (
            <ErrorBox error={season.error} />
          ) : (
            <Loading />
          )}
        </Sheet>

        <Sheet label="Season to date" title="Cumulative impact">
          {season.data ? (
            <dl className="space-y-4">
              {[
                ["Chemical volume", `−${fmt.pct(season.data.cumulative.chemical_reduction_pct)}`, `${fmt.litres(season.data.cumulative.volume_l)} vs ${fmt.litres(season.data.cumulative.blanket_volume_l)}`],
                ["Input cost saved", fmt.usd(season.data.cumulative.cost_saving), `${fmt.usd(season.data.cumulative.cost)} spent vs ${fmt.usd(season.data.cumulative.blanket_cost)}`],
                ["EIQ load", `−${fmt.pct(season.data.cumulative.eiq_reduction_pct)}`, "Cornell Environmental Impact Quotient"],
              ].map(([k, v, s]) => (
                <div key={k} className="border-b border-line pb-3 last:border-0">
                  <dt className="label">{k}</dt>
                  <dd className="num mt-1 text-2xl">{v}</dd>
                  <dd className="text-xs text-ink-3">{s}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Loading />
          )}
          <div className="mt-5 border-t border-line pt-4">
            <div className="label mb-2">Recent prescriptions</div>
            {rx.data?.length ? (
              <ul className="space-y-1.5 text-sm">
                {rx.data.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {p.field_id} · D{p.day}
                    </span>
                    <Pill color={p.status === "approved" ? "#2e5b3b" : undefined}>{p.status}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">None saved yet. Open a field and save one.</p>
            )}
          </div>
        </Sheet>
      </div>
    </div>
  );
}
