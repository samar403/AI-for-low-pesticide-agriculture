import {
  ArrowRight,
  BrainCircuit,
  Bug,
  Droplets,
  FileDown,
  Leaf,
  Plane,
  Radio,
  ScanSearch,
  ShieldCheck,
  Sprout,
  Waves,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { HeroField } from "../components/HeroField";
import { Logo } from "../components/ui";
import { api, DEFAULT_DAY } from "../lib/api";
import { fmt } from "../lib/format";
import { useAsync } from "../lib/hooks";

const STEPS = [
  {
    n: "01",
    icon: Plane,
    title: "Survey",
    body: "A drone flies the field with a multispectral and thermal camera. Every 10 m cell gets NDVI, red-edge, canopy temperature and sub-cell texture.",
  },
  {
    n: "02",
    icon: Radio,
    title: "Sense",
    body: "Pheromone traps, leaf-wetness, weather and soil probes report from the ground. They catch what a camera can't: the moth flight before the damage, the wet night before the blight.",
  },
  {
    n: "03",
    icon: BrainCircuit,
    title: "Decide",
    body: "The model classifies each cell as healthy, weedy, pest-hit or diseased, then fuses the sensor evidence. Agronomist-set thresholds and legal no-spray buffers turn that into a per-cell prescription.",
  },
  {
    n: "04",
    icon: Droplets,
    title: "Spray",
    body: "A variable-rate prescription and a drone mission that flies only the rows with targets. Export GeoJSON or CSV for any sprayer. Nothing flies without approval.",
  },
];

const FEATURES = [
  { icon: Sprout, title: "Field workspace", body: "Layer NDVI, red-edge, thermal, threat probability, prescription and flight path on one map. Scrub the season day by day." },
  { icon: Bug, title: "Sensor fusion", body: "Trap counts above the economic threshold raise pest odds nearby; empty traps lower them. Leaf-wetness hours drive disease risk." },
  { icon: ShieldCheck, title: "Guardrails built in", body: "Rates never exceed the label. Watercourse buffers are always zero. Every prescription is a draft until a person approves it." },
  { icon: ScanSearch, title: "Photo scout", body: "No drone yet? Upload a top-down photo. Excess-green segmentation and crop-row detection map the weeds between rows." },
  { icon: FileDown, title: "Open formats", body: "Prescriptions export as GeoJSON and CSV with lat/lon per cell, so they load into the farm-management and drone software growers already use." },
  { icon: Waves, title: "Live ingestion API", body: "Gateways push readings over HTTPS. Unknown stations and impossible values are rejected; accepted trap counts change the next prescription." },
];

const FAQ = [
  {
    q: "What happens when the model is wrong?",
    a: "Two safeguards. The action threshold and edge buffer are set by the agronomist, so they choose how cautious to be. And every prescription is a draft that has to be approved before it can be flown. The model card in the app shows precision, recall and the false-spray rate on held-out fields.",
  },
  {
    q: "Which drones and sprayers does it work with?",
    a: "Any that can take a variable-rate map. The prescription is per-cell GeoJSON and CSV with lat/lon and litres per hectare for each product, and missions are exported as spray-on/spray-off waypoints.",
  },
  {
    q: "Is the data in the demo real?",
    a: "No. The demo farm is a deterministic simulator: synthetic multispectral imagery, threat patches that grow through the season, and sensor histories. The ground truth is hidden from the model and used only to score it. The ingestion API is real and accepts your own readings.",
  },
  {
    q: "Who owns the field data?",
    a: "The grower. The platform stores telemetry and prescriptions in their own database, and the exports are open formats with no lock-in.",
  },
];

function LiveStrip() {
  const farm = useAsync(() => api.farm(DEFAULT_DAY), []);
  const t = farm.data?.totals;
  const items = t
    ? [
        { k: "of the farm needs treatment today", v: fmt.frac(t.treated_ha / t.cropped_ha) },
        { k: "less chemical than blanket spraying", v: fmt.pct(t.chemical_reduction_pct) },
        { k: "saved on inputs this pass", v: fmt.usd(t.cost_saving) },
        { k: "hotspots found across 4 fields", v: fmt.int(t.hotspots) },
      ]
    : [
        { k: "of the farm needs treatment today", v: "—" },
        { k: "less chemical than blanket spraying", v: "—" },
        { k: "saved on inputs this pass", v: "—" },
        { k: "hotspots found across 4 fields", v: "—" },
      ];
  return (
    <div className="border-y border-ink bg-ink text-paper">
      <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
        {items.map((i, idx) => (
          <div key={i.k} className={`px-5 py-5 ${idx ? "md:border-l" : ""} border-white/10 ${idx % 2 ? "border-l" : ""}`}>
            <div className="num text-3xl text-lime">{i.v}</div>
            <div className="mt-1 text-xs text-paper/70">{i.k}</div>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-6xl px-5 pb-3 text-[11px] text-paper/45">
        {farm.error ? "Live numbers appear when the API is running." : "Live from the demo farm API: Mesa Verde Farms, season day 55, simulated data."}
      </div>
    </div>
  );
}

export default function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const season = useAsync(() => api.season(DEFAULT_DAY), []);
  const cum = season.data?.cumulative;

  return (
    <div className="grid-paper min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm md:flex" aria-label="Main">
          <a href="#how" className="hover:underline">How it works</a>
          <a href="#platform" className="hover:underline">Platform</a>
          <a href="#impact" className="hover:underline">Impact</a>
          <a href="#faq" className="hover:underline">FAQ</a>
        </nav>
        <Link to="/app" className="inline-flex items-center gap-2 rounded-sm bg-ink px-4 py-2 text-sm text-paper hover:bg-ink-2">
          Open live demo <ArrowRight size={15} />
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-14 pt-8 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
        <div>
          <div className="label">Precision crop protection · drones + sensors + AI</div>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            Spray the patch,
            <br />
            <span className="italic text-moss">not the field.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
            Weeds, insects and blight arrive in patches, yet most fields are still sprayed wall to wall. Patchwork finds the patches from the air and the
            ground, and writes a prescription that puts chemical <span className="marker">only where the crop needs it</span>.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app" className="inline-flex items-center gap-2 rounded-sm bg-lime px-5 py-3 font-medium text-ink hover:bg-lime-2">
              Explore the demo farm <ArrowRight size={16} />
            </Link>
            <Link to="/app/scout" className="inline-flex items-center gap-2 rounded-sm border border-ink/30 px-5 py-3 font-medium hover:bg-paper-2">
              <ScanSearch size={16} /> Scout a photo
            </Link>
          </div>
        </div>
        <div className="sheet p-4">
          <HeroField />
        </div>
      </section>

      <LiveStrip />

      {/* Problem */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <div className="label">The problem</div>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight">Blanket spraying treats a map the farmer can't see.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              ["Money on the ground", "Chemical is one of a grower's largest variable costs, and most of it lands on healthy plants."],
              ["Resistance", "Spraying everything, every time, selects for resistant weeds and insects faster."],
              ["Water and pollinators", "Drift and runoff carry active ingredient into ditches, creeks and field margins."],
              ["Regulation is tightening", "Buyers and regulators want lower use and residues. The EU's Farm to Fork strategy targets halving pesticide use and risk by 2030."],
            ].map(([t, b]) => (
              <div key={t} className="border-l-2 border-moss pl-4">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-3">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-line bg-paper-2/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="label">How it works</div>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight">From a drone flight to a spot-spray plan in one loop.</h2>
          <ol className="mt-12 grid gap-px border border-line bg-line md:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-[#fbf9f3] p-6">
                <div className="flex items-center justify-between">
                  <span className="num text-sm text-ink-3">{s.n}</span>
                  <s.icon size={20} className="text-moss" />
                </div>
                <h3 className="mt-6 font-display text-2xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-3">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Platform */}
      <section id="platform" className="mx-auto max-w-6xl px-5 py-20">
        <div className="label">The platform</div>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight">Built for the agronomist who signs off on the spray.</h2>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="sheet p-6">
              <f.icon size={20} className="text-moss" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Impact */}
      <section id="impact" className="grid-paper-dark bg-moss text-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="label !text-paper/60">Impact so far this season (demo farm)</div>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight">Same protection. A fraction of the chemical.</h2>
            <p className="mt-4 max-w-md text-paper/75">
              Weekly scan-and-spray passes compared with spraying every product a field needed that week across the whole field. Numbers come from the
              simulator, so treat them as an illustration of the method rather than a field trial result.
            </p>
            <Link to="/app" className="mt-8 inline-flex items-center gap-2 rounded-sm bg-lime px-5 py-3 font-medium text-ink hover:bg-lime-2">
              See the breakdown <ArrowRight size={16} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-px self-center border border-white/15 bg-white/15">
            {[
              ["Chemical volume", cum ? fmt.pct(cum.chemical_reduction_pct) : "—", "reduction"],
              ["Environmental load (EIQ)", cum ? fmt.pct(cum.eiq_reduction_pct) : "—", "reduction"],
              ["Input cost", cum ? fmt.usd(cum.cost_saving) : "—", "saved over the season"],
              ["Product applied", cum ? `${fmt.int(cum.volume_l)} L` : "—", cum ? `instead of ${fmt.int(cum.blanket_volume_l)} L` : ""],
            ].map(([k, v, s]) => (
              <div key={k} className="bg-moss p-6">
                <div className="label !text-paper/60">{k}</div>
                <div className="num mt-3 text-4xl text-lime">{v}</div>
                <div className="mt-1 text-xs text-paper/70">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Model */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <div className="label">Why now</div>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight">The hardware got cheap. The decision is the product.</h2>
          </div>
          <div className="space-y-4 text-ink-2">
            <p>
              Spray drones and multispectral cameras are now ordinary farm equipment, and IoT traps and weather stations cost less than a tank of
              insecticide. What's missing is the layer in between: software that turns imagery and sensor readings into a decision an agronomist
              trusts and a sprayer can execute.
            </p>
            <p>
              Patchwork is that layer. It is sold per hectare per season to growers, and as a white-label workspace to drone spraying contractors who
              want to sell "precision" as a service.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {["Growers", "Agronomists & crop advisers", "Drone spray contractors", "Co-ops & input dealers"].map((x) => (
                <span key={x} className="rounded-full border border-ink/25 px-3 py-1 text-sm">
                  <Leaf size={12} className="mr-1 inline text-moss" />
                  {x}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-line bg-paper-2/60">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <div className="label">Questions</div>
          <h2 className="mt-3 font-display text-4xl font-semibold">Asked in the field</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {FAQ.map((f, i) => (
              <div key={f.q}>
                <button
                  className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium"
                  aria-expanded={openFaq === i}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {f.q}
                  <span className="num text-ink-3">{openFaq === i ? "−" : "+"}</span>
                </button>
                {openFaq === i && <p className="pb-5 text-sm leading-relaxed text-ink-3">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-16 md:flex-row md:items-center">
          <h2 className="font-display text-3xl font-semibold sm:text-4xl">
            Walk the demo farm. <span className="italic text-lime">No boots required.</span>
          </h2>
          <Link to="/app" className="inline-flex items-center gap-2 rounded-sm bg-lime px-5 py-3 font-medium text-ink hover:bg-lime-2">
            Open the dashboard <ArrowRight size={16} />
          </Link>
        </div>
        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-white/10 px-5 py-6 text-xs text-paper/55">
          <Logo dark className="scale-90" />
          <span>Demo data is simulated. Always follow the product label and local regulations.</span>
          <a href="/docs" className="hover:text-paper">API docs</a>
        </footer>
      </section>
    </div>
  );
}
