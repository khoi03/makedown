/** Small, pure display formatters shared across the inspector + cost views. */

const EM_DASH = "—";

/** Format a USD amount: 2 decimals for dollar-scale, 4 for sub-dollar costs. */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  return amount < 1 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

/** First 8 hex chars of a `sha256:...` (or bare) identity hash. */
export function shortHash(id: string): string {
  const hex = id.startsWith("sha256:") ? id.slice("sha256:".length) : id;
  return hex.slice(0, 8);
}

/** Human-friendly wall-clock duration. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return EM_DASH;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Token usage as "1,234 in · 567 out". */
export function formatTokens(usage: { input: number; output: number } | undefined): string {
  if (!usage) return EM_DASH;
  const n = (v: number) => v.toLocaleString("en-US");
  return `${n(usage.input)} in · ${n(usage.output)} out`;
}
