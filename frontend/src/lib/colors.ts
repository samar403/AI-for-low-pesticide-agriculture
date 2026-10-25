import type { ThreatClass } from "./api";

export const CLASS_COLOR: Record<ThreatClass, string> = {
  weed: "#d49a1e",
  pest: "#c4452d",
  disease: "#7b5aa6",
};

export const CLASS_LABEL: Record<ThreatClass, string> = {
  weed: "Weeds",
  pest: "Insect pests",
  disease: "Fungal disease",
};

export const PRODUCT_COLOR = { herbicide: "#d49a1e", insecticide: "#c4452d", fungicide: "#7b5aa6" } as const;

type Stop = [number, [number, number, number]];

function ramp(stops: Stop[]) {
  return (t: number): [number, number, number] => {
    const x = Math.min(1, Math.max(0, t));
    for (let i = 1; i < stops.length; i++) {
      const [p1, c1] = stops[i];
      const [p0, c0] = stops[i - 1];
      if (x <= p1) {
        const u = (x - p0) / (p1 - p0 || 1);
        return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * u)) as [number, number, number];
      }
    }
    return stops[stops.length - 1][1];
  };
}

// Vegetation: bare soil brown -> pale straw -> deep moss. Reads as "vigour" without a rainbow.
export const vegRamp = ramp([
  [0, [139, 94, 60]],
  [0.35, [214, 196, 140]],
  [0.65, [138, 176, 92]],
  [1, [30, 74, 44]],
]);

// Thermal: cool slate -> paper -> hot rust.
export const thermalRamp = ramp([
  [0, [52, 92, 120]],
  [0.5, [236, 230, 214]],
  [1, [196, 69, 45]],
]);

// Spray rate: transparent paper -> teal.
export const sprayRamp = ramp([
  [0, [222, 238, 236]],
  [1, [17, 92, 108]],
]);

export const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
