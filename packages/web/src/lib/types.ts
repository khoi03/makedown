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
