/**
 * A `transform` step — deterministic, zero-token. "Code where code is enough."
 *
 * The engine imports this ES module and calls the exported function with a map
 * of every declared input's content (keyed by its ref). Return a string (or
 * Uint8Array); it becomes the artifact. The script's own content is part of the
 * target's identity hash, so editing this file rebuilds the target.
 *
 * Here: turn a Markdown bullet list into a JSON array, which the `blurbs` target
 * then fans out over with a `map` step.
 */
export default function transform(inputs) {
  const items = inputs["sources/topics.md"]
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return JSON.stringify(items, null, 2);
}
