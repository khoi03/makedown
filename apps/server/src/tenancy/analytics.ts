/**
 * Analytics shapes for the cost dashboard — aggregates derived from the
 * provenance *index* (the denormalized, re-derivable projection over the CAS,
 * see {@link import("./types.js").ProvenanceRow}).
 *
 * Semantics worth stating plainly: the index is keyed by
 * `(workspace_id, identity_hash)` and upserted, so it measures the cost of
 * **distinct artifact production** — not raw API spend. Re-running an identical,
 * cache-hit build does not re-accrue. The dashboard labels figures accordingly.
 *
 * All aggregation is org-scoped and pushed into the data layer (SQL `GROUP BY`
 * in Postgres, an equivalent reduction in the in-memory store) so the server
 * never materializes every row to sum it.
 */

/** A half-open time window over `producedAt` (ISO-8601 text, lexically sortable). */
export interface AnalyticsRange {
  /** Inclusive lower bound (ISO string). Omit for "from the beginning". */
  readonly from?: string;
  /** Exclusive upper bound (ISO string). Omit for "up to now". */
  readonly to?: string;
}

/** One aggregated slice (a workspace, a model, a target, or a calendar day). */
export interface AnalyticsBucket {
  /** The dimension value: workspace id, model id, target name, or `YYYY-MM-DD`. */
  readonly key: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly costUsd: number;
  /** Number of distinct produced artifacts in this slice. */
  readonly runs: number;
}

/** Grand totals across the whole (org, range) selection. */
export interface AnalyticsTotals {
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly costUsd: number;
  readonly runs: number;
}

/** The four breakdowns the data layer returns for an (org, range) selection. */
export interface AnalyticsBreakdowns {
  readonly totals: AnalyticsTotals;
  readonly byWorkspace: readonly AnalyticsBucket[];
  readonly byModel: readonly AnalyticsBucket[];
  readonly byTarget: readonly AnalyticsBucket[];
  /** Ascending by day. */
  readonly byDay: readonly AnalyticsBucket[];
}

/** The full payload the read-API returns (breakdowns + the echoed selection). */
export interface AnalyticsSummary extends AnalyticsBreakdowns {
  readonly orgId: string;
  readonly range: { readonly from: string | null; readonly to: string | null };
}

/** Sentinel bucket key for provenance rows with no model (e.g. `transform`). */
export const NO_MODEL_KEY = "(none)";
