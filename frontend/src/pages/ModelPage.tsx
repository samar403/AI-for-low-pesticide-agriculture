import { ErrorBox, Kpi, Loading, Sheet } from "../components/ui";
import { api, type ClassMetric } from "../lib/api";
import { CLASS_COLOR } from "../lib/colors";
import { fmt } from "../lib/format";
import { useAsync } from "../lib/hooks";

const FEATURE_NOTES: Record<string, string> = {
  ndvi: "Normalised difference vegetation index: canopy vigour",
  ndre: "Red-edge index: chlorophyll content, drops early with disease",
  gndvi: "Green NDVI: nitrogen and chlorophyll",
  ndvi_anomaly: "Cell NDVI minus its 130 m neighbourhood",
  ndre_anomaly: "Cell NDRE minus its neighbourhood",
  thermal_anomaly: "Canopy temperature minus field median",
  texture: "NIR variation inside the cell: patchy weeds are speckled",
  exg_anomaly: "Excess-green vs neighbourhood from the RGB sensor",
};

const colorFor = (cls: string) => (cls in CLASS_COLOR ? CLASS_COLOR[cls as keyof typeof CLASS_COLOR] : "#2e5b3b");

export default function ModelPage() {
  const m = useAsync(() => api.model(), []);
  if (m.error) return <ErrorBox error={m.error} onRetry={m.reload} />;
  if (!m.data) return <Loading label="Loading model card" />;
  const { metrics, classes, features, weights } = m.data;
  const cm = metrics.confusion_matrix;
  const maxW = Math.max(...Object.values(weights).flatMap((w) => Object.values(w).map(Math.abs)));

  return (
    <div className="space-y-6">
      <div>
        <div className="label">Transparency</div>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Model card</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-3">
          The hotspot detector is a {m.data.type} over eight agronomic features. It is trained at start-up on {fmt.int(metrics.train_samples)} cells from
          simulated fields and scored on {fmt.int(metrics.eval_samples)} cells from {metrics.eval_fields} fields it has never seen. It is small on
          purpose: it runs on a laptop at the field edge, and every weight below can be read and questioned.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="moss" label="Accuracy (held-out)" value={fmt.frac(metrics.accuracy, 1)} />
        <Kpi tone="lime" label="Threat detection rate" value={fmt.frac(metrics.threat_detection_rate, 1)} sub="threat cells flagged as any threat" />
        <Kpi label="False-spray rate" value={fmt.frac(metrics.false_spray_rate, 1)} sub="healthy cells flagged" />
        <Kpi tone="spray" label="Classes" value={classes.length} sub={classes.join(" · ")} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Sheet label="Per class" title="Precision and recall">
          <table className="w-full text-sm">
            <thead>
              <tr className="label border-b border-line text-left">
                <th className="py-2 font-normal">Class</th>
                <th className="py-2 text-right font-normal">Precision</th>
                <th className="py-2 text-right font-normal">Recall</th>
                <th className="py-2 text-right font-normal">F1</th>
                <th className="py-2 text-right font-normal">Cells</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => {
                const x = metrics[c] as ClassMetric;
                return (
                  <tr key={c} className="border-b border-line/60">
                    <td className="py-2">
                      <span className="mr-2 inline-block h-2.5 w-2.5" style={{ background: colorFor(c) }} />
                      {c}
                    </td>
                    <td className="num py-2 text-right">{x.precision.toFixed(3)}</td>
                    <td className="num py-2 text-right">{x.recall.toFixed(3)}</td>
                    <td className="num py-2 text-right">{x.f1.toFixed(3)}</td>
                    <td className="num py-2 text-right">{fmt.int(x.support)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-3">
            Weed recall is the hardest: thin weed patches look like healthy canopy at 10 m. The prescription's edge buffer exists to cover those misses.
          </p>
        </Sheet>

        <Sheet label="Held-out fields" title="Confusion matrix">
          <div className="overflow-x-auto">
            <table className="num mx-auto text-sm">
              <thead>
                <tr>
                  <th className="label p-2 text-left font-normal">true ↓ / predicted →</th>
                  {classes.map((c) => (
                    <th key={c} className="label p-2 font-normal">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cm.map((row, i) => {
                  const total = row.reduce((a, b) => a + b, 0) || 1;
                  return (
                    <tr key={i}>
                      <th className="label p-2 text-left font-normal">{classes[i]}</th>
                      {row.map((v, j) => {
                        const share = v / total;
                        return (
                          <td
                            key={j}
                            className="h-14 w-20 border border-paper text-center"
                            style={{ background: i === j ? `rgba(46,91,59,${0.15 + share * 0.8})` : `rgba(196,69,45,${Math.min(0.7, share * 3)})`, color: share > 0.5 ? "#f2eee3" : "#17241c" }}
                          >
                            {fmt.int(v)}
                            <div className="text-[10px] opacity-75">{fmt.frac(share)}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Sheet>
      </div>

      <Sheet label="Explainability" title="What the model looks at" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="label border-b border-line text-left">
                <th className="px-5 py-2 font-normal">Feature</th>
                {classes.slice(1).map((c) => (
                  <th key={c} className="px-2 py-2 font-normal">
                    {c} weight
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f} className="border-b border-line/60">
                  <td className="px-5 py-2.5">
                    <div className="num text-xs">{f}</div>
                    <div className="text-xs text-ink-3">{FEATURE_NOTES[f]}</div>
                  </td>
                  {classes.slice(1).map((c) => {
                    const w = weights[c][f] - weights.healthy[f];
                    const width = (Math.abs(w) / (maxW * 2)) * 100;
                    return (
                      <td key={c} className="px-2 py-2.5">
                        <div className="relative h-3 w-40 bg-paper-2">
                          <div className="absolute top-0 h-full w-px bg-ink/40" style={{ left: "50%" }} />
                          <div
                            className="absolute top-0 h-full"
                            style={{
                              background: colorFor(c),
                              width: `${Math.min(50, width)}%`,
                              left: w >= 0 ? "50%" : `${50 - Math.min(50, width)}%`,
                            }}
                          />
                        </div>
                        <div className="num mt-0.5 text-[10px] text-ink-3">{w > 0 ? "+" : ""}{w.toFixed(2)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
          Weights are relative to the healthy class on standardised features: a positive bar means higher values of that feature push a cell towards
          that threat.
        </p>
      </Sheet>

      <Sheet label="After the image model" title="Sensor fusion">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>
            Trap counts are interpolated across the field (inverse distance) and divided by the economic threshold of 12 moths per trap per day. The log
            of that ratio is added to the pest log-odds, so busy traps raise pest probability nearby and empty traps lower it.
          </li>
          <li>
            The share of the last seven days with wet leaves at 12–26 °C gives a disease-risk index, which shifts disease log-odds up in infection
            weather and down in dry spells.
          </li>
          <li>Probabilities are lightly smoothed (3×3) before thresholding to suppress single-cell noise.</li>
        </ul>
      </Sheet>
    </div>
  );
}
