import { Bug, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorBox, Loading, Sheet } from "../components/ui";
import { api } from "../lib/api";
import { fmt } from "../lib/format";
import { useAsync } from "../lib/hooks";

const FIELD_IDS = ["north-40", "creekside", "mesa-block", "far-quarter"];
const METRICS_BY_KIND: Record<string, { key: string; unit: string; def: number }[]> = {
  trap: [{ key: "trap_count", unit: "insects / day", def: 30 }],
  weather: [
    { key: "air_temp_c", unit: "°C", def: 22 },
    { key: "humidity_pct", unit: "%", def: 70 },
    { key: "leaf_wetness", unit: "0–1", def: 0.6 },
    { key: "rain_mm", unit: "mm", def: 2 },
  ],
  soil: [
    { key: "soil_moisture_pct", unit: "% VWC", def: 28 },
    { key: "soil_temp_c", unit: "°C", def: 19 },
  ],
};

export default function Telemetry() {
  const [fieldId, setFieldId] = useState(FIELD_IDS[0]);
  const field = useAsync(() => api.field(fieldId), [fieldId]);
  const readings = useAsync(() => api.telemetry(), []);
  const [stationId, setStationId] = useState("");
  const [metric, setMetric] = useState("trap_count");
  const [value, setValue] = useState("30");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  const station = useMemo(() => field.data?.stations.find((s) => s.id === stationId) ?? field.data?.stations[0], [field.data, stationId]);
  const metrics = station ? METRICS_BY_KIND[station.kind] : [];
  const activeMetric = metrics.find((m) => m.key === metric) ?? metrics[0];

  async function send(payload: { station_id: string; metric: string; value: number }[]) {
    try {
      const res = await api.ingest(payload);
      setMsg({
        ok: res.accepted > 0,
        text: `${res.accepted} accepted${res.rejected.length ? `, ${res.rejected.length} rejected: ${res.rejected.map((r) => r.reason).join("; ")}` : ""}`,
      });
      readings.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const pestFlight = () => {
    const traps = field.data?.stations.filter((s) => s.kind === "trap") ?? [];
    const t = traps[Math.floor(Math.random() * traps.length)];
    if (t) send([0, 1, 2].map((i) => ({ station_id: t.id, metric: "trap_count", value: 35 + i * 6 })));
  };

  const curl = `curl -X POST ${location.origin}/api/telemetry \\
  -H 'Content-Type: application/json' \\
  -d '{"readings":[{"station_id":"${station?.id ?? "north-40-trap-1"}","metric":"${activeMetric?.key ?? "trap_count"}","value":${value || 0}}]}'`;

  return (
    <div className="space-y-6">
      <div>
        <div className="label">Operations</div>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Sensors & ingestion</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-3">
          Field gateways push readings to <code className="num">POST /api/telemetry</code>. Readings are validated against the station registry, stored,
          and used immediately: the newest trap counts replace the simulated ones in sensor fusion, so a moth flight changes the next prescription.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Sheet label="Manual reading" title="Push to the API">
          {field.error && <ErrorBox error={field.error} />}
          <form
            className="space-y-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (station && activeMetric) send([{ station_id: station.id, metric: activeMetric.key, value: Number(value) }]);
            }}
          >
            <label className="block">
              <span className="label">Field</span>
              <select className="mt-1 w-full rounded-sm border border-line bg-white px-2 py-1.5" value={fieldId} onChange={(e) => (setFieldId(e.target.value), setStationId(""))}>
                {FIELD_IDS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Station</span>
              <select
                className="mt-1 w-full rounded-sm border border-line bg-white px-2 py-1.5"
                value={station?.id ?? ""}
                onChange={(e) => {
                  setStationId(e.target.value);
                  const kind = field.data?.stations.find((s) => s.id === e.target.value)?.kind ?? "trap";
                  setMetric(METRICS_BY_KIND[kind][0].key);
                  setValue(String(METRICS_BY_KIND[kind][0].def));
                }}
              >
                {field.data?.stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} ({s.kind})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Metric</span>
                <select className="mt-1 w-full rounded-sm border border-line bg-white px-2 py-1.5" value={activeMetric?.key} onChange={(e) => setMetric(e.target.value)}>
                  {metrics.map((m) => (
                    <option key={m.key}>{m.key}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Value ({activeMetric?.unit})</span>
                <input
                  className="num mt-1 w-full rounded-sm border border-line bg-white px-2 py-1.5"
                  type="number"
                  step="any"
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit">
                <Send size={14} /> Send reading
              </Button>
              <Button type="button" variant="lime" onClick={pestFlight}>
                <Bug size={14} /> Simulate moth flight
              </Button>
            </div>
            {msg && (
              <p className={`text-xs ${msg.ok ? "text-moss" : "text-pest"}`} role="status">
                {msg.text}
                {msg.ok && (
                  <>
                    {" · "}
                    <Link className="underline" to={`/app/fields/${fieldId}`}>
                      see the effect on {fieldId}
                    </Link>
                  </>
                )}
              </p>
            )}
          </form>
          <div className="mt-5">
            <div className="label mb-1">Same thing from a gateway</div>
            <pre className="num overflow-x-auto rounded-sm bg-ink p-3 text-[11px] leading-relaxed text-lime">{curl}</pre>
            <p className="mt-2 text-xs text-ink-3">
              Or run <code className="num">python scripts/gateway_simulator.py</code> to stream readings for every station.
            </p>
          </div>
        </Sheet>

        <Sheet label="Ingested" title="Latest readings" pad={false}>
          {readings.error && (
            <div className="p-5">
              <ErrorBox error={readings.error} />
            </div>
          )}
          {!readings.data && !readings.error && (
            <div className="p-5">
              <Loading />
            </div>
          )}
          {readings.data && (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#fbf9f3]">
                  <tr className="label border-b border-line">
                    <th className="px-5 py-2 font-normal">Station</th>
                    <th className="px-2 py-2 font-normal">Metric</th>
                    <th className="px-2 py-2 text-right font-normal">Value</th>
                    <th className="px-5 py-2 font-normal">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.data.map((r, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="num px-5 py-1.5 text-xs">{r.station_id}</td>
                      <td className="px-2 py-1.5 text-xs">{r.metric}</td>
                      <td className="num px-2 py-1.5 text-right">{r.value}</td>
                      <td className="px-5 py-1.5 text-xs text-ink-3">{fmt.datetime(r.received_at)}</td>
                    </tr>
                  ))}
                  {!readings.data.length && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-ink-3">
                        Nothing ingested yet. Send a reading on the left.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Sheet>
      </div>
    </div>
  );
}
