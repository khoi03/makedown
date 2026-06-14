/**
 * Pure transforms for the cost-analytics dashboard. Kept separate from the React
 * components so the bucketing/scaling logic is unit-tested in isolation and the
 * view stays declarative. All display formatting reuses {@link ./format.js}.
 */
import type { AnalyticsBucket } from "./types.js";

const MS_PER_DAY = 86_400_000;

/** A selectable time window for the dashboard. `days: null` = all time. */
export interface RangePreset {
  readonly label: string;
  readonly days: number | null;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: null },
];

/** The default window when the dashboard first opens. */
export const DEFAULT_RANGE_DAYS = 30;

/** Map a preset to the API's optional `from` lower bound (inclusive, ISO). */
export function rangeFromPreset(days: number | null, now: Date = new Date()): { from?: string } {
  if (days === null) return {};
  return { from: new Date(now.getTime() - days * MS_PER_DAY).toISOString() };
}

/** A bucket annotated with its cost as a 0..1 fraction of the largest bucket. */
export type ScaledBucket = AnalyticsBucket & { readonly fraction: number };

/**
 * Annotate each bucket with `fraction` = its cost relative to the max cost in
 * the set (for bar widths). Zero-safe: an all-zero set yields all-zero
 * fractions. Order is preserved (the server already sorts by cost desc).
 */
export function withBarFractions(buckets: readonly AnalyticsBucket[]): ScaledBucket[] {
  const max = buckets.reduce((m, b) => Math.max(m, b.costUsd), 0);
  return buckets.map((b) => ({ ...b, fraction: max > 0 ? b.costUsd / max : 0 }));
}

/** Thousands-grouped integer (token counts, run counts). */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
