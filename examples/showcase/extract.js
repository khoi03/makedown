/**
 * A zero-token `transform` step over an *auto-imported* binary source.
 *
 * `sources/quarterly-report.html` is referenced directly in this target's
 * `inputs:`. The engine converts it to Markdown on resolve (via MarkItDown) and
 * hands this transform that Markdown text, keyed by the original ref. Editing the
 * HTML re-imports and restales the target; no API key is involved.
 *
 * It distills the report into a compact, model-ready brief: the title, the bold
 * headline figures, the highlight bullets, and the segment-revenue table kept
 * verbatim. The downstream `summary` chat step consumes this brief instead of the
 * raw conversion, so the prompt stays small and the cost estimate stays honest.
 *
 * @param {Record<string, string>} inputs - resolved input text keyed by ref.
 * @returns {string} Markdown brief (always a string, even for empty input).
 */
export default function extract(inputs) {
  const markdown = inputs["sources/quarterly-report.html"] ?? "";
  const lines = markdown.split(/\r?\n/);

  const title = (lines.find((line) => /^#\s+/.test(line)) ?? "# Report")
    .replace(/^#\s+/, "")
    .trim();

  const boldFigures = unique(
    [...markdown.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].trim()),
  );

  const highlights = lines
    .filter((line) => /^\s*[*-]\s+/.test(line))
    .map((line) => line.replace(/^\s*[*-]\s+/, "").trim())
    .filter(Boolean);

  const table = extractFirstTable(lines);

  const out = [`# Key figures — ${title}`, ""];

  out.push("## Headline metrics", "");
  const metrics = boldFigures.length > 0 ? boldFigures : ["(none found)"];
  for (const figure of metrics) out.push(`- ${figure}`);
  out.push("");

  if (highlights.length > 0) {
    out.push("## Highlights", "");
    for (const highlight of highlights) out.push(`- ${highlight}`);
    out.push("");
  }

  if (table.length > 0) {
    out.push("## Segment revenue", "", ...table, "");
  }

  return out.join("\n");
}

/** First contiguous run of Markdown table rows (lines starting with `|`). */
function extractFirstTable(lines) {
  const rows = [];
  for (const line of lines) {
    const isRow = /^\s*\|/.test(line);
    if (isRow) rows.push(line.trim());
    else if (rows.length > 0) break;
  }
  return rows;
}

/** Stable de-duplication preserving first-seen order. */
function unique(items) {
  return [...new Set(items)];
}
