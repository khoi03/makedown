/**
 * View types for the web client. These mirror the shapes the server returns but
 * are defined locally on purpose: @makedown/server is a Node package (fastify,
 * node:*), so the browser bundle must not import it. Small, deliberate
 * duplication keeps the client a clean standalone bundle.
 */

export type StepType = "chat" | "agent" | "transform" | "eval" | "map";

export interface ResolvedInput {
  readonly ref: string;
  readonly kind: "source" | "target";
  readonly hash: string;
}

export interface GraphTargetView {
  readonly name: string;
  readonly step: StepType;
  readonly stale: boolean;
  readonly id: string;
  readonly output: string;
  readonly deps: readonly string[];
  readonly inputs: readonly ResolvedInput[];
}

export interface GraphView {
  readonly order: readonly string[];
  readonly targets: readonly GraphTargetView[];
}

export interface Provenance {
  readonly target: string;
  readonly id: string;
  readonly output: string;
  readonly step: StepType;
  readonly model?: string;
  /** The model the recipe requested, present only when a fallback changed it. */
  readonly requestedModel?: string;
  /** True when the router fell back from `requestedModel` to `model`. */
  readonly fellBack?: boolean;
  readonly params: Readonly<Record<string, unknown>>;
  readonly inputs: readonly ResolvedInput[];
  readonly promptHash: string;
  readonly tokens?: { readonly input: number; readonly output: number };
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly producedAt: string;
  readonly producedBy?: string;
}

export interface ArtifactView {
  readonly target: string;
  readonly content: string;
  readonly provenance: Provenance;
}

export interface TargetCost {
  readonly target: string;
  readonly step: StepType;
  readonly model?: string;
  readonly stale: boolean;
  readonly calls: number;
  readonly inputTokens: number;
  readonly maxOutputTokens: number;
  readonly costUsd?: number;
}

export interface BuildCost {
  readonly targets: readonly TargetCost[];
  readonly totalCostUsd: number;
  readonly hasUnpriced: boolean;
}

export interface Snapshot {
  readonly sha: string;
  readonly message: string;
  readonly date: string;
  readonly author: string;
}

export interface BranchInfo {
  readonly current: string;
  readonly branches: readonly string[];
}

/** Per-target lifecycle event (mirrors the engine's BuildEvent). */
export type BuildEvent =
  | { readonly type: "target-start"; readonly target: string; readonly stale: boolean }
  | { readonly type: "target-built"; readonly target: string }
  | { readonly type: "target-reused"; readonly target: string }
  | { readonly type: "target-denied"; readonly target: string }
  | { readonly type: "target-skipped"; readonly target: string };

export interface PendingApproval {
  readonly id: string;
  readonly jobId: string;
  readonly target: string;
  readonly output: string;
  readonly preview: string;
  readonly step: StepType;
}

/** Events streamed from the build SSE endpoint. */
export type BuildStreamEvent =
  | { readonly type: "progress"; readonly event: BuildEvent }
  | { readonly type: "approval-pending"; readonly approval: PendingApproval }
  | {
      readonly type: "done";
      readonly built: readonly string[];
      readonly reused: readonly string[];
      readonly rejected: readonly string[];
    }
  | { readonly type: "error"; readonly message: string };

/** Live build status used to badge graph nodes. */
export type TargetRunStatus = "idle" | "building" | "built" | "reused" | "denied" | "skipped";

/** A freshly created share — the token (and thus the link) is returned once. */
export interface CreatedShare {
  readonly id: string;
  readonly token: string;
  /** Server-relative path (`/s/<token>`); the client prefixes its origin. */
  readonly path: string;
  readonly expiresAt: string | null;
}

/** A share as listed for its author — never includes token material. */
export interface ShareSummary {
  readonly id: string;
  readonly target: string;
  readonly includeProvenance: boolean;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revoked: boolean;
}

// --- cost analytics (mirrors the server's tenancy/analytics shapes) ----------

/** One aggregated slice: a workspace, a model, a target, or a `YYYY-MM-DD` day. */
export interface AnalyticsBucket {
  readonly key: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly costUsd: number;
  readonly runs: number;
}

export interface AnalyticsTotals {
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly costUsd: number;
  readonly runs: number;
}

export interface AnalyticsSummary {
  readonly orgId: string;
  readonly range: { readonly from: string | null; readonly to: string | null };
  readonly totals: AnalyticsTotals;
  readonly byWorkspace: readonly AnalyticsBucket[];
  readonly byModel: readonly AnalyticsBucket[];
  readonly byTarget: readonly AnalyticsBucket[];
  readonly byDay: readonly AnalyticsBucket[];
}

/** The analytics endpoint envelope: `enabled:false` ⇒ single-tenant (no index). */
export interface AnalyticsResponse {
  readonly enabled: boolean;
  readonly summary?: AnalyticsSummary;
}
