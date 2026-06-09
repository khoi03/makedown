/**
 * Zod schemas + helpers for validating the raw YAML in `build.md` target
 * blocks and front matter. The parser (in @makedown/format) uses these to turn
 * untrusted text into typed data at the system boundary.
 */
import { z } from "zod";
import type { CachePolicy } from "./types.js";

export const stepSchema = z.enum(["chat", "agent", "transform", "eval", "map"]);
export const sandboxSchema = z.enum(["worktree", "container", "none"]);
export const approvalSchema = z.enum(["none", "required"]);

/** Raw recipe header as it appears in YAML (cache is still a string here). */
export const recipeHeaderSchema = z
  .object({
    inputs: z.array(z.string()).default([]),
    step: stepSchema.default("chat"),
    model: z.string().optional(),
    params: z.record(z.unknown()).default({}),
    output: z.string().optional(),
    cache: z.string().optional(),
    agent: z.string().optional(),
    sandbox: sandboxSchema.default("worktree"),
    approval: approvalSchema.default("none"),
    transform: z.string().optional(),
    over: z.string().optional(),
    schema: z.union([z.string(), z.record(z.unknown())]).optional(),
  })
  .strict();

export const frontMatterSchema = z
  .object({
    version: z.string().optional(),
    defaults: z
      .object({
        model: z.string().optional(),
        params: z.record(z.unknown()).optional(),
        cache: z.string().optional(),
      })
      .strict()
      .optional(),
    artifacts_dir: z.string().default("artifacts"),
    sources_dir: z.string().default("."),
  })
  .strict();

export type RawRecipeHeader = z.infer<typeof recipeHeaderSchema>;
export type RawFrontMatter = z.infer<typeof frontMatterSchema>;

const STOCHASTIC_RE = /^stochastic\(n=(\d+)\)$/;

/** Parse a cache-policy string (SPEC.md §7) into a typed CachePolicy. */
export function parseCachePolicy(raw: string | undefined): CachePolicy {
  if (raw === undefined || raw === "deterministic") {
    return { kind: "deterministic" };
  }
  if (raw === "always") {
    return { kind: "always" };
  }
  const match = STOCHASTIC_RE.exec(raw.trim());
  if (match) {
    return { kind: "stochastic", n: Number(match[1] ?? "0") };
  }
  throw new Error(
    `Invalid cache policy: "${raw}" (expected "deterministic", "always", or "stochastic(n=<k>)")`,
  );
}

/** Inverse of parseCachePolicy — used by the serializer. */
export function cachePolicyToString(policy: CachePolicy): string {
  switch (policy.kind) {
    case "deterministic":
      return "deterministic";
    case "always":
      return "always";
    case "stochastic":
      return `stochastic(n=${policy.n})`;
  }
}

/** Target name rule from SPEC.md §3.1. */
export const TARGET_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidTargetName(name: string): boolean {
  return TARGET_NAME_RE.test(name);
}
