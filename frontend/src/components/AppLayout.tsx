import { BrainCircuit, ClipboardList, LayoutGrid, Menu, Radio, ScanSearch, Sprout, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { seasonDate } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSeason } from "../lib/season";
import { Logo } from "./ui";

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/app/prescriptions", label: "Prescriptions", icon: ClipboardList },
  { to: "/app/scout", label: "Photo scout", icon: ScanSearch },
  { to: "/app/telemetry", label: "Sensors & ingest", icon: Radio },
  { to: "/app/model", label: "Model card", icon: BrainCircuit },
];

const FIELDS = [
  { id: "north-40", name: "North 40", crop: "Maize" },
  { id: "creekside", name: "Creekside", crop: "Tomato" },
  { id: "mesa-block", name: "Mesa Block", crop: "Cotton" },
  { id: "far-quarter", name: "Far Quarter", crop: "Soybean" },
];

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors ${
      isActive ? "bg-lime text-ink" : "text-paper/75 hover:bg-white/5 hover:text-paper"
    }`;
  return (
    <nav className="flex flex-col gap-1" aria-label="Dashboard">
      {NAV.slice(0, 1).map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={link} onClick={onNavigate}>
          <n.icon size={16} /> {n.label}
        </NavLink>
      ))}
      <div className="label mt-5 mb-1 px-3 !text-paper/40">Fields</div>
      {FIELDS.map((f) => (
        <NavLink key={f.id} to={`/app/fields/${f.id}`} className={link} onClick={onNavigate}>
          <Sprout size={16} />
          <span className="flex-1">{f.name}</span>
          <span className="num text-[10px] opacity-60">{f.crop}</span>
        </NavLink>
      ))}
      <div className="label mt-5 mb-1 px-3 !text-paper/40">Operations</div>
      {NAV.slice(1).map((n) => (
        <NavLink key={n.to} to={n.to} className={link} onClick={onNavigate}>
          <n.icon size={16} /> {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function SeasonControl() {
  const { day, setDay } = useSeason();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor="season-day" className="label hidden sm:block">
        Season day
      </label>
      <input
        id="season-day"
        type="range"
        min={10}
        max={75}
        value={day}
        onChange={(e) => setDay(Number(e.target.value))}
        className="w-28 sm:w-44"
        aria-valuetext={`Day ${day}, ${seasonDate(day)}`}
      />
      <span className="num w-28 text-sm">
        D{day} · {seasonDate(day)}
      </span>
    </div>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const health = useAsync(() => fetch("/api/health").then((r) => (r.ok ? r.json() : Promise.reject())), []);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="grid-paper-dark sticky top-0 hidden h-screen flex-col bg-ink px-4 py-5 lg:flex">
        <Link to="/" className="px-2">
          <Logo dark />
        </Link>
        <div className="mt-8 flex-1 overflow-y-auto">
          <SideNav />
        </div>
        <div className="mt-4 rounded-sm border border-white/10 p-3 text-xs text-paper/70">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${health.data ? "bg-lime" : health.loading ? "bg-weed" : "bg-pest"}`} />
            {health.data ? "API online" : health.loading ? "Connecting…" : "API offline"}
          </div>
          <div className="mt-1 opacity-70">Mesa Verde Farms · demo data</div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 bg-ink/50 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="grid-paper-dark h-full w-72 bg-ink px-4 py-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-8 flex items-center justify-between">
              <Logo dark />
              <button aria-label="Close menu" className="text-paper" onClick={() => setOpen(false)}>
                <X />
              </button>
            </div>
            <SideNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="grid-paper min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-paper/90 px-4 py-3 backdrop-blur sm:px-8">
          <button className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu />
          </button>
          <div className="label hidden md:block">{loc.pathname.replace("/app", "dashboard").replaceAll("/", " / ") || "dashboard"}</div>
          <SeasonControl />
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
