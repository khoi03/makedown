import { describe, it, expect } from "vitest";
import { renderSharePage, renderNotFoundPage } from "./render.js";
import type { Provenance } from "@makedown/shared";

/**
 * The public share page is server-rendered HTML served with no auth, so the
 * artifact body is the top XSS surface. Markdown artifacts render to a safe
 * subset (no scripts, no event handlers); anything else renders as escaped
 * preformatted text. Provenance is opt-in.
 */
const PROVENANCE: Provenance = {
  target: "summary",
  id: "sha256:abcdef0123456789",
  output: "artifacts/summary.md",
  step: "chat",
  model: "claude-opus-4-8",
  params: {},
  inputs: [{ kind: "source", ref: "sources/a.md", hash: "sha256:deadbeef" }],
  promptHash: "sha256:cafe",
  tokens: { input: 5, output: 7 },
  costUsd: 0.02,
  durationMs: 1234,
  producedAt: "2026-06-13T00:00:00Z",
};

describe("renderSharePage", () => {
  it("renders Markdown to formatted HTML", () => {
    const html = renderSharePage({
      target: "summary",
      output: "artifacts/summary.md",
      content: "# Title\n\nA **bold** point.",
    });
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("Title");
  });

  it("strips scripts and event handlers from Markdown (XSS)", () => {
    const html = renderSharePage({
      target: "evil",
      output: "artifacts/evil.md",
      content: '# Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[link](javascript:alert(3))',
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("onerror");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("renders non-Markdown artifacts as escaped preformatted text", () => {
    const html = renderSharePage({
      target: "code",
      output: "artifacts/snippet.ts",
      content: 'const x = "<script>alert(1)</script>";',
    });
    expect(html).toContain("<pre");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("omits provenance unless asked", () => {
    const html = renderSharePage({
      target: "summary",
      output: "artifacts/summary.md",
      content: "hello",
    });
    expect(html).not.toContain("claude-opus-4-8");
    expect(html.toLowerCase()).not.toContain("provenance");
  });

  it("includes provenance when provided", () => {
    const html = renderSharePage({
      target: "summary",
      output: "artifacts/summary.md",
      content: "hello",
      provenance: PROVENANCE,
    });
    expect(html).toContain("claude-opus-4-8");
    expect(html).toContain("sources/a.md");
  });

  it("escapes the target name in the page title (no header injection via name)", () => {
    const html = renderSharePage({
      target: "<script>alert(1)</script>",
      output: "artifacts/x.md",
      content: "hello",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("produces a self-contained document (no external scripts)", () => {
    const html = renderSharePage({ target: "t", output: "artifacts/t.md", content: "hi" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script\b/i);
  });
});

describe("renderNotFoundPage", () => {
  it("returns a minimal document without leaking why", () => {
    const html = renderNotFoundPage();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.toLowerCase()).toContain("not found");
  });
});
