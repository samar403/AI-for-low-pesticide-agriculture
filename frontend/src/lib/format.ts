export const fmt = {
  int: (n: number) => Math.round(n).toLocaleString("en-US"),
  num: (n: number, d = 1) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
  pct: (n: number, d = 0) => `${n.toLocaleString("en-US", { maximumFractionDigits: d })}%`,
  frac: (n: number, d = 0) => `${(n * 100).toLocaleString("en-US", { maximumFractionDigits: d })}%`,
  usd: (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
  litres: (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 1 })} L`,
  date: (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  datetime: (iso: string) =>
    new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
};

const SEASON_START = new Date("2026-08-31T00:00:00Z");
export const seasonDate = (day: number) =>
  new Date(SEASON_START.getTime() + day * 86_400_000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
