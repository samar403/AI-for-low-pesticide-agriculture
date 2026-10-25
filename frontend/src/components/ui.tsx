import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Logo({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  const base = dark ? "#2e5b3b" : "#c9d3b8";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        {[0, 1, 2].flatMap((r) =>
          [0, 1, 2].map((c) => {
            const fill = r === 1 && c === 1 ? "#cfe34b" : r === 1 && c === 2 ? "#c4452d" : base;
            return <rect key={`${r}${c}`} x={3 + c * 9} y={3 + r * 9} width="8" height="8" fill={fill} />;
          }),
        )}
      </svg>
      <span className={`font-display text-xl font-semibold tracking-tight ${dark ? "text-paper" : "text-ink"}`}>Patchwork</span>
    </span>
  );
}

export function Sheet({
  label,
  title,
  aside,
  children,
  className = "",
  pad = true,
}: {
  label?: string;
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`sheet ${className}`}>
      {(label || title || aside) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
          <div>
            {label && <div className="label mb-1">{label}</div>}
            {title && <h2 className="font-display text-lg font-semibold leading-tight">{title}</h2>}
          </div>
          {aside}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "moss" | "lime" | "spray";
}) {
  const tones = {
    ink: "bg-[#fbf9f3] text-ink",
    moss: "bg-moss text-paper",
    lime: "bg-lime text-ink",
    spray: "bg-[#e5f0ee] text-ink",
  };
  return (
    <div className={`sheet ${tones[tone]} px-5 py-4`}>
      <div className={`label ${tone === "moss" ? "!text-paper/70" : ""}`}>{label}</div>
      <div className="num mt-2 text-3xl font-medium tracking-tight">{value}</div>
      {sub && <div className={`mt-1 text-xs ${tone === "moss" ? "text-paper/75" : "text-ink-3"}`}>{sub}</div>}
    </div>
  );
}

export function Button({
  variant = "ink",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ink" | "lime" | "ghost" }) {
  const v = {
    ink: "bg-ink text-paper hover:bg-ink-2",
    lime: "bg-lime text-ink hover:bg-lime-2",
    ghost: "border border-ink/30 bg-transparent text-ink hover:bg-paper-2",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-sm px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="num inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-wider"
      style={{ borderColor: color ?? "#17241c33", color: color ?? "#2b3a30" }}
    >
      {children}
    </span>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-ink-3" role="status">
      <span className="grid grid-cols-3 gap-0.5">
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="h-1.5 w-1.5 animate-pulse bg-moss" style={{ animationDelay: `${(i % 4) * 120}ms` }} />
        ))}
      </span>
      {label}…
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="sheet border-pest/40 bg-[#fbeee9] p-4 text-sm" role="alert">
      <div className="label !text-pest">API error</div>
      <p className="mt-1">{error.message}</p>
      <p className="mt-1 text-xs text-ink-3">Is the backend running? Start it with <code className="num">make api</code>.</p>
      {onRetry && (
        <Button variant="ghost" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Bar({ value, max, color = "#2e5b3b", marker }: { value: number; max: number; color?: string; marker?: number }) {
  const w = Math.min(100, (value / (max || 1)) * 100);
  return (
    <div className="relative h-2 w-full bg-paper-2">
      <div className="h-full" style={{ width: `${w}%`, background: color }} />
      {marker !== undefined && (
        <div className="absolute -top-1 h-4 w-px bg-ink" style={{ left: `${Math.min(100, (marker / (max || 1)) * 100)}%` }} />
      )}
    </div>
  );
}
