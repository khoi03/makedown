import { describe, it, expect } from "vitest";
import { renderShareHtml } from "./share.js";
import type { Provenance } from "@makedown/shared";

/**
 * `md share` exports a self-contained, read-only HTML view of a built artifact —
 * the standalone (no-server) sharing path. It renders the artifact as escaped
 * preformatted text (zero XSS risk, zero dependencies), with optional provenance.
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

describe("renderShareHtml", () => {
  it("produces a self-contained document with no scripts", () => {
    const html = renderShareHtml({ target: "summary", content: "hello" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain("hello");
  });

  it("escapes artifact content (never interprets it as markup)", () => {
    const html = renderShareHtml({
      target: "evil",
      content: '<script>alert(1)</script><img src=x onerror="alert(2)">',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("onerror=\"alert");
  });

  it("escapes the target name", () => {
    const html = renderShareHtml({ target: "<b>x</b>", content: "hi" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("omits provenance by default", () => {
    const html = renderShareHtml({ target: "summary", content: "hi" });
    expect(html).not.toContain("claude-opus-4-8");
  });

  it("includes provenance when provided", () => {
    const html = renderShareHtml({ target: "summary", content: "hi", provenance: PROVENANCE });
    expect(html).toContain("claude-opus-4-8");
    expect(html).toContain("sources/a.md");
    expect(html).toContain("$0.02");
  });
});
