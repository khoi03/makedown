/**
 * A dependency-free daily-spend bar chart. Renders an SVG of cost-per-day bars
 * scaled to the busiest day, with accessible per-bar titles. Compositor-friendly
 * (static SVG, no layout animation) and tiny — no charting library.
 */
import { useMemo } from "react";
import type { AnalyticsBucket } from "../../lib/types.js";
import { formatUsd } from "../../lib/format.js";

export interface DailySpendChartProps {
  readonly days: readonly AnalyticsBucket[];
}

const VIEW_W = 720;
const VIEW_H = 160;
const GAP = 2;

export function DailySpendChart({ days }: DailySpendChartProps) {
  const max = useMemo(() => days.reduce((m, d) => Math.max(m, d.costUsd), 0), [days]);

  if (days.length === 0) return <p className="dash__muted">No data.</p>;

  const barW = Math.max(1, (VIEW_W - GAP * (days.length - 1)) / days.length);

  return (
    <svg
      className="dash__chart"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Daily spend across ${days.length} day(s)`}
    >
      {days.map((d, i) => {
        const h = max > 0 ? (d.costUsd / max) * (VIEW_H - 2) : 0;
        const x = i * (barW + GAP);
        return (
          <rect
            key={d.key}
            className="dash__chart-bar"
            x={x}
            y={VIEW_H - h}
            width={barW}
            height={h}
            rx={1}
          >
            <title>{`${d.key}: ${formatUsd(d.costUsd)} · ${d.runs} run(s)`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
