/**
 * Core domain types for Makedown. Pure data — no IO, no side effects.
 * These types are shared across the engine, format parser, providers, and CLI.
 */

/** The kind of computation a target performs. See SPEC.md §6. */
export type StepType = "chat" | "agent" | "transform" | "eval" | "map";

/** Isolation level for steps that run code/agents. */
export type Sandbox = "worktree" | "container" | "none";

/** Whether an artifact must be human-approved before downstream consumption. */
export type Approval = "none" | "required";

/**
 * How the provider router orders a target's fallback candidates. `strict`
 * tries them in declared order; `cost-aware` keeps the primary first but sorts
 * the fallback alternatives cheapest-first. See SPEC.md §7.
 */
export type RoutePolicy = "strict" | "cost-aware";

/** Cache / determinism policy for a target. See SPEC.md §7. */
export type CachePolicy =
  | { readonly kind: "deterministic" }
  | { readonly kind: "stochastic"; readonly n: number }
  | { readonly kind: "always" };

/**
 * A fully-resolved recipe header (after merging document defaults).
 * This is what the engine hashes and executes.
 */
export interface RecipeHeader {
  readonly inputs: readonly string[];
  readonly step: StepType;
  readonly model?: string;
  /**
   * Ordered fallback models (each a `provider:model` ref) tried when the primary
   * fails transiently. Folds into the identity hash (part of the target's spec).
   */
  readonly fallback?: readonly string[];
  /** How the router orders the fallback candidates. Default: "strict". */
  readonly route?: RoutePolicy;
  /** System prompt for the model. May contain `{{ref}}` interpolations. */
  readonly system?: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly output: string;
  readonly cache: CachePolicy;
  readonly agent?: string;
  readonly sandbox: Sandbox;
  readonly approval: Approval;
  readonly transform?: string;
  readonly over?: string;
  readonly schema?: string | Readonly<Record<string, unknown>>;
}

/** One node in the build graph: a named recipe + its prompt body. */
export interface TargetBlock {
  readonly name: string;
  readonly header: RecipeHeader;
  /** Prompt body (Markdown). May contain `{{ref}}` interpolations. */
  readonly body: string;
}

/** Workspace-level defaults declared in `build.md` front matter. */
export interface FrontMatter {
  readonly version?: string;
  readonly defaults?: {
    readonly model?: string;
    readonly system?: string;
    readonly params?: Readonly<Record<string, unknown>>;
    readonly cache?: CachePolicy;
  };
  readonly artifactsDir: string;
  readonly sourcesDir: string;
}

/** A parsed `build.md` document: the whole build graph as data. */
export interface BuildDoc {
  readonly frontMatter: FrontMatter;
  readonly targets: readonly TargetBlock[];
}

/** Whether an input reference points at a source file or another target. */
export type InputKind = "source" | "target";

/** An input after resolution: its kind and content hash. */
export interface ResolvedInput {
  readonly ref: string;
  readonly kind: InputKind;
  readonly hash: string; // "sha256:..."
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

/**
 * Provenance record stored alongside every produced artifact. See SPEC.md §8.
 * This is what powers `md why`, reproducibility, and cost analytics.
 */
export interface Provenance {
  readonly target: string;
  /** Identity hash that addresses this artifact in the CAS. "sha256:..." */
  readonly id: string;
  readonly output: string;
  readonly step: StepType;
  /** The model that actually produced this artifact (after any fallback). */
  readonly model?: string;
  /** The model the recipe requested, set only when a fallback changed it. */
  readonly requestedModel?: string;
  /** True when the router fell back from `requestedModel` to `model`. */
  readonly fellBack?: boolean;
  readonly params: Readonly<Record<string, unknown>>;
  readonly inputs: readonly ResolvedInput[];
  readonly promptHash: string;
  readonly tokens?: TokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
  /** ISO 8601 UTC, e.g. "2026-06-09T12:00:00Z". */
  readonly producedAt: string;
  readonly producedBy?: string;
}

/** A compiled output plus its provenance. */
export interface Artifact {
  readonly id: string;
  readonly target: string;
  readonly content: Uint8Array;
  readonly provenance: Provenance;
}
