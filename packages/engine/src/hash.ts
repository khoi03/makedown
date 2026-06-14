/**
 * Content-addressing primitives. Pure and deterministic — the heart of
 * incremental rebuild (SPEC.md §7).
 */
import { createHash } from "node:crypto";
import type { RecipeHeader } from "@makedown/shared";

/** Hash arbitrary bytes/text into a "sha256:<hex>" id. */
export function sha256(data: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

/** Stable JSON: object keys sorted recursively so equal data hashes equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Fields of a recipe header that affect the *computation* (and thus identity).
 * Output path and approval gating are intentionally excluded — they don't
 * change the produced content.
 */
function normalizeHeader(header: RecipeHeader): Record<string, unknown> {
  return {
    inputs: [...header.inputs],
    step: header.step,
    // The fallback chain + route are part of the target's identity: they declare
    // which models may legitimately produce this artifact. Folding them in keeps
    // the identity hash a pure function of the recipe spec (not the runtime model
    // that actually answered — that lives in provenance). See SPEC.md §5/§7.
    fallback: header.fallback ? [...header.fallback] : null,
    route: header.route ?? null,
    system: header.system ?? null,
    cache: header.cache,
    agent: header.agent ?? null,
    sandbox: header.sandbox,
    transform: header.transform ?? null,
    over: header.over ?? null,
    schema: header.schema ?? null,
  };
}

export interface IdentityInput {
  /** Resolved content hashes (or dependency identity hashes) of every input. */
  readonly inputHashes: readonly string[];
  readonly header: RecipeHeader;
  readonly body: string;
  /**
   * Extra content hashes that affect the output but are not declared inputs —
   * e.g. the content of a `transform` script. Folded into the identity so the
   * artifact rebuilds when that content changes. Omit (or empty) to keep the
   * hash identical to a recipe with no auxiliary content.
   */
  readonly auxHashes?: readonly string[];
}

/**
 * Compute a target's identity hash. Two builds with the same resolved inputs +
 * recipe + model + params + prompt produce the same id, enabling cache reuse.
 */
export function computeIdentityHash({ inputHashes, header, body, auxHashes }: IdentityInput): string {
  const segments = [
    canonicalJson([...inputHashes]),
    canonicalJson(normalizeHeader(header)),
    body,
    header.model ?? "",
    canonicalJson(header.params),
  ];
  if (auxHashes && auxHashes.length > 0) {
    segments.push("aux:" + canonicalJson([...auxHashes]));
  }
  return sha256(segments.join("\n \n"));
}
