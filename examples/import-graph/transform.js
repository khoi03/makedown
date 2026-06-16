/**
 * A zero-token `transform` step over an *auto-imported* binary source.
 *
 * `sources/report.html` is referenced directly in the target's `inputs:`. The
 * engine converts it to Markdown on resolve (via MarkItDown) and hands the
 * transform that Markdown text — keyed by the original ref. Editing the HTML
 * re-imports and restales this target; no API key is involved.
 */
export default function reportStats(inputs) {
  const markdown = inputs["sources/report.html"] ?? "";
  const words = markdown.split(/\s+/).filter(Boolean).length;
  const headings = markdown
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.replace(/^#{1,6}\s/, "").trim());

  return [
    "# Report stats (from auto-imported HTML)",
    "",
    `- Word count: ${words}`,
    `- Headings: ${headings.length}`,
    "",
    "## Section titles",
    ...headings.map((h) => `- ${h}`),
    "",
  ].join("\n");
}
