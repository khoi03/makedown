/** Pure presentational helpers for provenance records (kept out of components for testability). */
import type { Provenance } from "./types.js";

/**
 * A short, honest note for when a build fell back to a different model than the
 * recipe requested — e.g. "fell back from anthropic:claude-opus-4-8". Returns
 * undefined when no fallback occurred, so the UI shows nothing extra.
 */
export function fallbackNote(p: Pick<Provenance, "fellBack" | "requestedModel">): string | undefined {
  if (!p.fellBack || !p.requestedModel) return undefined;
  return `fell back from ${p.requestedModel}`;
}
