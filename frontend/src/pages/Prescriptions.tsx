import { Download } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, ErrorBox, Loading, Pill, Sheet } from "../components/ui";
import { api, type RxStatus } from "../lib/api";
import { fmt, seasonDate } from "../lib/format";
import { useAsync } from "../lib/hooks";

const NEXT: Partial<Record<RxStatus, { to: RxStatus; label: string }>> = {
  draft: { to: "approved", label: "Approve" },
  approved: { to: "flown", label: "Mark flown" },
  flown: { to: "archived", label: "Archive" },
};

const STATUS_COLOR: Record<RxStatus, string | undefined> = {
  draft: undefined,
  approved: "#2e5b3b",
  flown: "#1f7a8c",
  archived: "#5b675d",
};

export default function Prescriptions() {
  const list = useAsync(() => api.prescriptions(), []);

  async function advance(id: string, to: RxStatus) {
    await api.setStatus(id, to);
    list.reload();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="label">Operations</div>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Prescriptions</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-3">
          Every spray plan starts as a draft. An agronomist approves it, the operator flies it, and the record stays here with its rules, volumes and
          export files.
        </p>
      </div>

      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && !list.data.length && (
        <Sheet>
          <p className="text-sm">
            No saved prescriptions yet. Open a field such as{" "}
            <Link className="underline" to="/app/fields/north-40">
              North 40
            </Link>
            , tune the rules and press <b>Save draft</b>.
          </p>
        </Sheet>
      )}
      {list.data && list.data.length > 0 && (
        <Sheet pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="label border-b border-line">
                  {["Field", "Survey", "Rules", "Treated", "Product", "Saving", "Mission", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id} className="border-b border-line/60 align-top">
                    <td className="px-4 py-3">
                      <Link to={`/app/fields/${p.field_id}`} className="font-medium underline-offset-2 hover:underline">
                        {p.field_id}
                      </Link>
                      <div className="num text-[11px] text-ink-3">{p.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      D{p.day} · {seasonDate(p.day)}
                      <div className="text-[11px] text-ink-3">saved {fmt.datetime(p.created_at)}</div>
                    </td>
                    <td className="num px-4 py-3 text-xs">
                      ≥{fmt.frac(p.params.threshold)} · +{p.params.buffer_cells} cell
                      <br />
                      min {p.params.min_patch_cells} · {p.params.no_spray_buffer ? "buffer on" : "buffer off"}
                    </td>
                    <td className="num px-4 py-3">{fmt.frac(p.summary.treated_fraction)}</td>
                    <td className="num px-4 py-3">
                      {fmt.litres(p.summary.volume_l)}
                      <div className="text-[11px] text-ink-3">vs {fmt.litres(p.summary.blanket_volume_l)}</div>
                    </td>
                    <td className="num px-4 py-3">
                      −{fmt.pct(p.summary.chemical_reduction_pct)}
                      <div className="text-[11px] text-ink-3">{fmt.usd(p.summary.cost_saving)}</div>
                    </td>
                    <td className="num px-4 py-3">
                      {fmt.num(p.mission.total_time_min, 0)} min
                      <div className="text-[11px] text-ink-3">{p.mission.tank_refills} refills</div>
                    </td>
                    <td className="px-4 py-3">
                      <Pill color={STATUS_COLOR[p.status]}>{p.status}</Pill>
                      {p.approved_at && <div className="mt-1 text-[11px] text-ink-3">{fmt.datetime(p.approved_at)}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-2">
                        {NEXT[p.status] && (
                          <Button variant={p.status === "draft" ? "lime" : "ghost"} className="!px-2.5 !py-1 text-xs" onClick={() => advance(p.id, NEXT[p.status]!.to)}>
                            {NEXT[p.status]!.label}
                          </Button>
                        )}
                        <div className="flex gap-2 text-xs">
                          <a className="inline-flex items-center gap-1 underline" href={`/api/prescriptions/${p.id}/geojson`}>
                            <Download size={11} />
                            GeoJSON
                          </a>
                          <a className="inline-flex items-center gap-1 underline" href={`/api/prescriptions/${p.id}/csv`}>
                            CSV
                          </a>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sheet>
      )}
    </div>
  );
}
