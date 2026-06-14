/**
 * `md share` — a standalone, read-only HTML export of a built artifact. Unlike
 * the server's hosted `/s/:token` view, this needs no server, no database, and
 * no token: it writes a self-contained `.html` file you can host anywhere. To
 * keep the Apache-2.0 CLI dependency-light and the export trivially safe, the
 * artifact is rendered as escaped preformatted text (never interpreted as
 * markup), with optional provenance.
 */
import type { Provenance } from "@makedown/shared";

export interface ShareExportView {
  readonly target: string;
  readonly content: string;
  /** Included only when the caller passes `--provenance`. */
  readonly provenance?: Provenance;
}

/** HTML-escape a string for safe interpolation into text contexts. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderProvenance(p: Provenance): string {
  const rows: Array<[string, string]> = [];
  if (p.model) rows.push(["Model", p.model]);
  rows.push(["Step", p.step]);
  if (p.tokens) rows.push(["Tokens", `in ${p.tokens.input} / out ${p.tokens.output}`]);
  if (p.costUsd !== undefined) rows.push(["Cost", `$${p.costUsd.toFixed(2)}`]);
  rows.push(["Produced", p.producedAt]);
  const meta = rows
    .map(([k, v]) => `<div class="prov__row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");
  const inputs = p.inputs
    .map((i) => `<li><span class="prov__kind">${escapeHtml(i.kind)}</span> ${escapeHtml(i.ref)}</li>`)
    .join("");
  return `
    <section class="prov">
      <h2>Provenance</h2>
      <dl class="prov__grid">${meta}</dl>
      ${inputs ? `<div class="prov__inputs"><span class="prov__label">Inputs</span><ul>${inputs}</ul></div>` : ""}
    </section>`;
}

/** Render a self-contained HTML document for a built artifact. */
export function renderShareHtml(view: ShareExportView): string {
  const title = escapeHtml(view.target);
  const provenance = view.provenance ? renderProvenance(view.provenance) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · makedown</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="page">
  <header class="head">
    <span class="head__mark">md</span>
    <div>
      <h1 class="head__title">${title}</h1>
      <p class="head__sub">Read-only shared artifact</p>
    </div>
  </header>
  <pre class="raw">${escapeHtml(view.content)}</pre>
  ${provenance}
  <footer class="foot">Exported with <strong>makedown</strong> — make for LLM workflows.</footer>
</main>
</body>
</html>`;
}

const PAGE_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: radial-gradient(1000px 520px at 78% -12%, #1b2440, transparent 62%), #0b0e16; color: #d7dce6; font: 16px/1.65 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; }
.page { max-width: 52rem; margin: 0 auto; padding: clamp(1.5rem, 4vw, 4rem) 1.25rem 4rem; }
.head { display: flex; align-items: center; gap: .9rem; margin-bottom: 2rem; }
.head__mark { display: grid; place-items: center; width: 2.1rem; height: 2.1rem; flex: none; border-radius: .5rem; background: #5b8cff; color: #0b0e16; font: 700 .85rem/1 ui-monospace, Menlo, monospace; }
.head__title { margin: 0; font-size: clamp(1.4rem, 1rem + 1.6vw, 2.1rem); letter-spacing: -.02em; color: #f3f5fa; word-break: break-word; }
.head__sub { margin: 0; color: #79839a; font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; }
.raw { background: #121622; border: 1px solid #222a3d; border-radius: .9rem; padding: clamp(1.1rem, 3vw, 2rem); margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Menlo, monospace; font-size: .85rem; color: #c4cbd9; }
.prov { margin-top: 1.5rem; background: #0f1320; border: 1px solid #222a3d; border-radius: .9rem; padding: 1rem 1.25rem; }
.prov h2 { margin: 0 0 1rem; color: #aab3c6; font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; }
.prov__grid { margin: 0; display: grid; gap: .5rem; }
.prov__row { display: grid; grid-template-columns: 7rem 1fr; gap: .75rem; font-size: .9rem; }
.prov__row dt { color: #79839a; margin: 0; }
.prov__row dd { margin: 0; color: #d7dce6; word-break: break-word; }
.prov__inputs { margin-top: .9rem; }
.prov__label { color: #79839a; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; }
.prov__inputs ul { margin: .4rem 0 0; padding: 0; list-style: none; display: grid; gap: .25rem; font-size: .85rem; }
.prov__kind { display: inline-block; min-width: 3.4rem; padding: 0 .35rem; border-radius: .25rem; background: #1a2133; color: #8b95ab; font-size: .72rem; text-align: center; }
.foot { margin-top: 2.5rem; color: #5e677c; font-size: .8rem; text-align: center; }
.foot strong { color: #8fb0ff; font-weight: 600; }
`;
