/**
 * Server-rendered HTML for the public, no-auth `/s/:token` view. This is the
 * single most exposed surface in the server, so safety is layered:
 *  - Markdown artifacts are parsed by `marked`, then run through `sanitize-html`
 *    with a strict allow-list (no `<script>`, no event handlers, no
 *    `javascript:` URLs) — only a safe rendering subset survives.
 *  - Any non-Markdown artifact (code, diffs, data) is HTML-escaped and shown as
 *    preformatted text — never interpreted as markup.
 *  - Every interpolated value (target name, provenance fields) is escaped.
 *  - The document is fully self-contained: inline styles, zero scripts.
 * The route pairs this with a strict `Content-Security-Policy` as defense in depth.
 */
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { Provenance } from "@makedown/shared";

export interface SharePageView {
  readonly target: string;
  /** The artifact's output path; its extension decides Markdown vs. plain. */
  readonly output: string;
  readonly content: string;
  /** Included only when the share opted into provenance. */
  readonly provenance?: Provenance;
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/** HTML-escape a string for safe interpolation into text/attribute contexts. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isMarkdown(output: string): boolean {
  const dot = output.lastIndexOf(".");
  if (dot === -1) return false;
  return MARKDOWN_EXTENSIONS.has(output.slice(dot).toLowerCase());
}

/** Render Markdown to a sanitized safe subset of HTML. */
function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content, { async: false, gfm: true, breaks: false });
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "a", "ul", "ol", "li", "blockquote",
      "code", "pre", "em", "strong", "del", "hr", "br",
      "table", "thead", "tbody", "tr", "th", "td",
      "img",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt"],
      th: ["align"],
      td: ["align"],
    },
    // Drop javascript:/vbscript:/file: etc.; keep only safe link/image schemes.
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer" }, true),
    },
  });
}

function renderBody(view: SharePageView): string {
  if (isMarkdown(view.output)) {
    return `<article class="md">${renderMarkdown(view.content)}</article>`;
  }
  return `<pre class="raw">${escapeHtml(view.content)}</pre>`;
}

function renderProvenance(p: Provenance): string {
  const rows: Array<[string, string]> = [];
  if (p.model) rows.push(["Model", p.model]);
  rows.push(["Step", p.step]);
  if (p.tokens) rows.push(["Tokens", `in ${p.tokens.input} / out ${p.tokens.output}`]);
  if (p.costUsd !== undefined) rows.push(["Cost", `$${p.costUsd.toFixed(4)}`]);
  rows.push(["Produced", p.producedAt]);
  const meta = rows
    .map(([k, v]) => `<div class="prov__row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");
  const inputs = p.inputs
    .map((i) => `<li><span class="prov__kind">${escapeHtml(i.kind)}</span> ${escapeHtml(i.ref)}</li>`)
    .join("");
  return `
    <details class="prov" open>
      <summary>Provenance</summary>
      <dl class="prov__grid">${meta}</dl>
      ${inputs ? `<div class="prov__inputs"><span class="prov__label">Inputs</span><ul>${inputs}</ul></div>` : ""}
    </details>`;
}

/** A full, self-contained HTML document for a shared artifact. */
export function renderSharePage(view: SharePageView): string {
  const title = escapeHtml(view.target);
  const provenance = view.provenance ? renderProvenance(view.provenance) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · makedown</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="page">
  <header class="head">
    <span class="head__mark">md</span>
    <div class="head__meta">
      <h1 class="head__title">${title}</h1>
      <p class="head__sub">Read-only shared artifact</p>
    </div>
  </header>
  ${renderBody(view)}
  ${provenance}
  <footer class="foot">Published with <strong>makedown</strong> — make for LLM workflows.</footer>
</main>
</body>
</html>`;
}

/** A minimal 404 document that does not disclose why the link is invalid. */
export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not found · makedown</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="page page--center">
  <span class="head__mark">md</span>
  <h1 class="notfound__title">Link not found</h1>
  <p class="notfound__sub">This shared link is invalid, expired, or has been revoked.</p>
</main>
</body>
</html>`;
}

/* Editorial dark surface, consistent with the build-workbench palette but
   self-contained (no token imports — this page ships standalone). */
const PAGE_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background:
    radial-gradient(1000px 520px at 78% -12%, #1b2440, transparent 62%),
    #0b0e16;
  color: #d7dce6;
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.page { max-width: 52rem; margin: 0 auto; padding: clamp(1.5rem, 4vw, 4rem) 1.25rem 4rem; }
.page--center { min-height: 100vh; display: grid; place-content: center; text-align: center; gap: .5rem; }
.head { display: flex; align-items: center; gap: .9rem; margin-bottom: 2rem; }
.head__mark {
  display: grid; place-items: center; width: 2.1rem; height: 2.1rem; flex: none;
  border-radius: .5rem; background: #5b8cff; color: #0b0e16;
  font: 700 .85rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.head__title { margin: 0; font-size: clamp(1.4rem, 1rem + 1.6vw, 2.1rem); letter-spacing: -.02em; color: #f3f5fa; word-break: break-word; }
.head__sub, .head__meta { margin: 0; }
.head__sub { color: #79839a; font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; }
.md, .raw {
  background: #121622; border: 1px solid #222a3d; border-radius: .9rem;
  padding: clamp(1.1rem, 3vw, 2rem);
}
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md h1, .md h2, .md h3 { color: #f3f5fa; letter-spacing: -.01em; line-height: 1.3; }
.md a { color: #8fb0ff; }
.md code { background: #0b0e16; padding: .1em .35em; border-radius: .3em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
.md pre { background: #0b0e16; padding: 1rem; border-radius: .6rem; overflow: auto; }
.md pre code { background: none; padding: 0; }
.md blockquote { margin: 1rem 0; padding: .2rem 0 .2rem 1rem; border-left: 3px solid #5b8cff; color: #aab3c6; }
.md table { border-collapse: collapse; width: 100%; }
.md th, .md td { border: 1px solid #222a3d; padding: .4rem .6rem; text-align: left; }
.md img { max-width: 100%; height: auto; border-radius: .5rem; }
.raw { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; color: #c4cbd9; }
.prov { margin-top: 1.5rem; background: #0f1320; border: 1px solid #222a3d; border-radius: .9rem; padding: 1rem 1.25rem; }
.prov summary { cursor: pointer; color: #aab3c6; font-weight: 600; font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; }
.prov__grid { margin: 1rem 0 0; display: grid; gap: .5rem; }
.prov__row { display: grid; grid-template-columns: 7rem 1fr; gap: .75rem; font-size: .9rem; }
.prov__row dt { color: #79839a; margin: 0; }
.prov__row dd { margin: 0; color: #d7dce6; word-break: break-word; }
.prov__inputs { margin-top: .9rem; }
.prov__label { color: #79839a; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; }
.prov__inputs ul { margin: .4rem 0 0; padding: 0; list-style: none; display: grid; gap: .25rem; font-size: .85rem; }
.prov__kind { display: inline-block; min-width: 3.4rem; padding: 0 .35rem; border-radius: .25rem; background: #1a2133; color: #8b95ab; font-size: .72rem; text-align: center; }
.foot { margin-top: 2.5rem; color: #5e677c; font-size: .8rem; text-align: center; }
.foot strong { color: #8fb0ff; font-weight: 600; }
.notfound__title { margin: 1rem 0 0; color: #f3f5fa; font-size: 1.5rem; }
.notfound__sub { color: #79839a; max-width: 28rem; }
`;
