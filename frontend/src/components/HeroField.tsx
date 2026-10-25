import { useEffect, useMemo, useState } from "react";

const COLS = 30;
const ROWS = 16;

// Small deterministic PRNG so the hero looks the same on every load.
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATCHES = [
  { r: 4, c: 6, rad: 2.6, color: "#d49a1e" },
  { r: 11, c: 20, rad: 2.2, color: "#c4452d" },
  { r: 5, c: 23, rad: 1.8, color: "#7b5aa6" },
  { r: 12, c: 9, rad: 1.6, color: "#d49a1e" },
];

/**
 * Animated illustration: a drone sweeps the field, hotspots appear behind it,
 * and only those cells are marked for spraying.
 */
export function HeroField() {
  const cells = useMemo(() => {
    const rnd = mulberry32(7);
    const out: { r: number; c: number; fill: string; spray: boolean; threat?: string }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = 0.55 + 0.25 * Math.sin(c / 4 + r / 7) + rnd() * 0.15;
        const g = Math.round(90 + v * 70);
        let fill = `rgb(${Math.round(g * 0.42)},${g},${Math.round(g * 0.5)})`;
        let spray = false;
        let threat: string | undefined;
        for (const p of PATCHES) {
          const d = Math.hypot(r - p.r, (c - p.c) / 1.3);
          if (d < p.rad) {
            fill = p.color;
            threat = p.color;
            spray = true;
          } else if (d < p.rad + 1) {
            spray = true;
          }
        }
        out.push({ r, c, fill, spray, threat });
      }
    }
    return out;
  }, []);

  // Sweep position 0..1, driven by rAF (SMIL is unreliable across browsers).
  const [t, setT] = useState(1);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      // 5 s sweep, then hold the finished map for 1.5 s.
      const phase = ((now - start) / 6500) % 1;
      setT(Math.min(1, phase / (5 / 6.5)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const S = 18;
  const W = COLS * S;
  const H = ROWS * S;

  return (
    <svg viewBox={`-2 -10 ${W + 4} ${H + 36}`} className="h-auto w-full" role="img" aria-label="Illustration: a drone scans a field and marks only the infested patches for spraying">
      <defs>
        <clipPath id="reveal">
          <rect x="0" y="0" height={H} width={t * W} />
        </clipPath>
        <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="#1f7a8c" strokeWidth="2" />
        </pattern>
      </defs>
      {/* Base canopy, uniform green: what the eye sees */}
      {cells.map((k) => (
        <rect key={`b${k.r}-${k.c}`} x={k.c * S} y={k.r * S} width={S - 1} height={S - 1} fill="#7aa35a" opacity={0.85} />
      ))}
      {/* What the drone sees, revealed behind the sweep */}
      <g clipPath="url(#reveal)">
        {cells.map((k) => (
          <rect key={`v${k.r}-${k.c}`} x={k.c * S} y={k.r * S} width={S - 1} height={S - 1} fill={k.fill} />
        ))}
        {cells
          .filter((k) => k.spray)
          .map((k) => (
            <rect
              key={`s${k.r}-${k.c}`}
              x={k.c * S + 0.5}
              y={k.r * S + 0.5}
              width={S - 2}
              height={S - 2}
              fill={k.threat ? "none" : "url(#hatch)"}
              stroke="#cfe34b"
              strokeWidth={k.threat ? 2 : 0}
            />
          ))}
      </g>
      {/* Drone */}
      <g transform={`translate(${t * W} 0)`} opacity={t >= 1 ? 0 : 1}>
        <line x1="0" y1="0" x2="0" y2={H} stroke="#cfe34b" strokeWidth="2" />
        <rect x="-14" y={-2} width="28" height="6" fill="#17241c" rx="1" />
        <circle cx="-14" cy="1" r="5" fill="none" stroke="#17241c" strokeWidth="1.5" />
        <circle cx="14" cy="1" r="5" fill="none" stroke="#17241c" strokeWidth="1.5" />
      </g>
      <g fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#5b675d">
        <text x="0" y={H + 18}>FIG. 01 · NDVI + THERMAL SWEEP → HOTSPOTS → SPOT-SPRAY CELLS</text>
        <text x={W} y={H + 18} textAnchor="end">
          10 m CELLS
        </text>
      </g>
    </svg>
  );
}
