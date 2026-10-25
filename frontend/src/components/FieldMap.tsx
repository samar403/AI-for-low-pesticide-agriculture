import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Hotspot, Station } from "../lib/api";
import { CLASS_COLOR } from "../lib/colors";

export interface Waypoint {
  x_m: number;
  y_m: number;
  spray: boolean;
}

interface Props {
  rows: number;
  cols: number;
  cellM: number;
  /** Fill colour for a cell, or null for "not cropped". */
  cellColor: (r: number, c: number) => string | null;
  noSpray?: number[][];
  hotspots?: Hotspot[];
  highlight?: string | null;
  stations?: Station[];
  waypoints?: Waypoint[];
  describe?: (r: number, c: number) => ReactNode;
  onCellClick?: (r: number, c: number) => void;
  /** Bump to force a redraw when cellColor's inputs change. */
  version?: unknown;
  ariaLabel: string;
}

/**
 * Canvas renderer for a field's management grid. One pixel-crisp square per
 * 10 m cell, with vector overlays for hotspots, sensors and the drone path.
 */
export function FieldMap({
  rows,
  cols,
  cellM,
  cellColor,
  noSpray,
  hotspots,
  highlight,
  stations,
  waypoints,
  describe,
  onCellClick,
  version,
  ariaLabel,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cell = width / cols;
  const height = cell * rows;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !width) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = cellColor(r, c);
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(c * cell, r * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    // Faint cell lines when cells are big enough to read.
    if (cell >= 9) {
      ctx.strokeStyle = "rgba(23,36,28,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < cols; c++) {
        ctx.moveTo(c * cell + 0.5, 0);
        ctx.lineTo(c * cell + 0.5, height);
      }
      for (let r = 1; r < rows; r++) {
        ctx.moveTo(0, r * cell + 0.5);
        ctx.lineTo(width, r * cell + 0.5);
      }
      ctx.stroke();
    }

    // No-spray buffer: diagonal hatching.
    if (noSpray) {
      ctx.save();
      ctx.beginPath();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (noSpray[r]?.[c]) ctx.rect(c * cell, r * cell, cell, cell);
      ctx.clip();
      ctx.strokeStyle = "rgba(31,122,140,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = -height; k < width; k += 6) {
        ctx.moveTo(k, height);
        ctx.lineTo(k + height, 0);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Hotspot outlines
    hotspots?.forEach((h) => {
      const { row_min, row_max, col_min, col_max } = h.bbox;
      const on = highlight === h.id;
      ctx.strokeStyle = CLASS_COLOR[h.class];
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.setLineDash(on ? [] : [4, 3]);
      ctx.strokeRect(col_min * cell - 2, row_min * cell - 2, (col_max - col_min + 1) * cell + 4, (row_max - row_min + 1) * cell + 4);
      if (on) {
        ctx.fillStyle = CLASS_COLOR[h.class] + "22";
        ctx.fillRect(col_min * cell - 2, row_min * cell - 2, (col_max - col_min + 1) * cell + 4, (row_max - row_min + 1) * cell + 4);
      }
    });
    ctx.setLineDash([]);

    // Drone path
    if (waypoints && waypoints.length > 1) {
      const px = (m: number) => (m / cellM) * cell;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      waypoints.forEach((w) => ctx.lineTo(px(w.x_m), px(w.y_m)));
      ctx.strokeStyle = "rgba(23,36,28,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "#17241c";
      ctx.lineWidth = Math.max(1.5, cell * 0.22);
      for (let i = 0; i < waypoints.length - 1; i++) {
        if (!waypoints[i].spray) continue;
        ctx.beginPath();
        ctx.moveTo(px(waypoints[i].x_m), px(waypoints[i].y_m));
        ctx.lineTo(px(waypoints[i + 1].x_m), px(waypoints[i + 1].y_m));
        ctx.stroke();
      }
      ctx.fillStyle = "#cfe34b";
      ctx.strokeStyle = "#17241c";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(4, 4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Sensors
    stations?.forEach((s) => {
      const x = s.col * cell;
      const y = s.row * cell;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#17241c";
      ctx.fillStyle = s.kind === "trap" ? "#fbf9f3" : s.kind === "weather" ? "#cfe34b" : "#8a6a44";
      ctx.beginPath();
      if (s.kind === "trap") {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y + 5);
        ctx.lineTo(x - 6, y + 5);
        ctx.closePath();
      } else if (s.kind === "weather") {
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      } else {
        ctx.rect(x - 4.5, y - 4.5, 9, 9);
      }
      ctx.fill();
      ctx.stroke();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, rows, cols, version, hotspots, highlight, stations, waypoints, noSpray]);

  const onMove = (e: React.MouseEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / cell);
    const r = Math.floor(y / cell);
    if (r < 0 || c < 0 || r >= rows || c >= cols) return setHover(null);
    setHover({ r, c, x, y });
  };

  return (
    <div ref={wrap} className="relative w-full select-none">
      <canvas
        ref={canvas}
        role="img"
        aria-label={ariaLabel}
        style={{ width, height, display: "block", cursor: onCellClick ? "pointer" : "crosshair" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => hover && onCellClick?.(hover.r, hover.c)}
      />
      {/* Scale bar: 100 m */}
      {width > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-end gap-1.5 rounded-sm bg-paper/85 px-1.5 py-1">
          <div className="h-1.5 border-x border-b border-ink" style={{ width: (100 / cellM) * cell }} />
          <span className="num text-[10px] leading-none">100 m</span>
        </div>
      )}
      {hover && describe && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 rounded-sm border border-ink bg-ink px-2.5 py-2 text-xs text-paper shadow-lg"
          style={{
            left: Math.min(hover.x + 14, width - 170),
            top: hover.y + 14 > height - 90 ? hover.y - 90 : hover.y + 14,
          }}
        >
          <div className="num mb-1 text-[10px] text-lime">
            CELL {hover.r}·{hover.c}
          </div>
          {describe(hover.r, hover.c)}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; hatch?: boolean; shape?: "tri" | "dot" | "sq" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.shape === "tri" ? (
            <svg width="12" height="11" viewBox="0 0 12 11">
              <path d="M6 1 L11 10 L1 10Z" fill={i.color} stroke="#17241c" strokeWidth="1.3" />
            </svg>
          ) : (
            <span
              className={`inline-block h-3 w-3 border border-ink/40 ${i.hatch ? "hatch" : ""} ${i.shape === "dot" ? "rounded-full" : ""}`}
              style={{ background: i.hatch ? undefined : i.color }}
            />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function GradientLegend({ from, to, stops, unit }: { from: string; to: string; stops: string[]; unit?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-ink-3">
      <span className="num">{from}</span>
      <span className="h-2 w-32 border border-ink/20" style={{ background: `linear-gradient(to right, ${stops.join(",")})` }} />
      <span className="num">{to}</span>
      {unit && <span>{unit}</span>}
    </div>
  );
}
