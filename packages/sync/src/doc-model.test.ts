import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  BUILD_DOC_KEY,
  SOURCES_KEY,
  getBuildText,
  getSourceText,
  listSourcePaths,
  loadSnapshot,
  applySnapshot,
  type WorkspaceSnapshot,
} from "./doc-model.js";

/**
 * The Yjs workspace document is the live, collaborative truth (CRDT for text).
 * Git snapshots are materialized from it and reloaded into it. These tests pin
 * the document schema, plain-snapshot round-tripping, reconciliation, and
 * multi-replica convergence — all headless, no browser.
 */
describe("workspace doc model", () => {
  const sample: WorkspaceSnapshot = {
    buildMd: "## target: one\n```yaml\nstep: chat\n```\nHello.",
    sources: { "sources/a.md": "alpha", "sources/b.md": "beta" },
  };

  it("loads an empty snapshot from a fresh doc", () => {
    const doc = new Y.Doc();
    expect(loadSnapshot(doc)).toEqual({ buildMd: "", sources: {} });
  });

  it("round-trips a snapshot through apply -> load", () => {
    const doc = new Y.Doc();
    applySnapshot(doc, sample);
    expect(loadSnapshot(doc)).toEqual(sample);
  });

  it("exposes build.md as a live Y.Text under the documented key", () => {
    const doc = new Y.Doc();
    applySnapshot(doc, sample);
    expect(getBuildText(doc)).toBe(doc.getText(BUILD_DOC_KEY));
    expect(getBuildText(doc).toString()).toBe(sample.buildMd);
  });

  it("exposes each source as a live Y.Text under the sources map", () => {
    const doc = new Y.Doc();
    applySnapshot(doc, sample);
    expect(doc.getMap(SOURCES_KEY).has("sources/a.md")).toBe(true);
    expect(getSourceText(doc, "sources/a.md").toString()).toBe("alpha");
    expect(listSourcePaths(doc).sort()).toEqual(["sources/a.md", "sources/b.md"]);
  });

  it("reconciles on re-apply: updates changed, adds new, removes deleted", () => {
    const doc = new Y.Doc();
    applySnapshot(doc, sample);
    const before = getSourceText(doc, "sources/a.md");

    applySnapshot(doc, {
      buildMd: sample.buildMd,
      sources: { "sources/a.md": "alpha", "sources/c.md": "gamma" },
    });

    // a.md unchanged -> same Y.Text instance preserved (no churn, history intact)
    expect(getSourceText(doc, "sources/a.md")).toBe(before);
    expect(loadSnapshot(doc).sources).toEqual({
      "sources/a.md": "alpha",
      "sources/c.md": "gamma",
    });
    expect(doc.getMap(SOURCES_KEY).has("sources/b.md")).toBe(false);
  });

  it("converges two replicas after exchanging updates", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applySnapshot(a, sample);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // b catches up to a

    // concurrent edits on different replicas
    getBuildText(a).insert(0, "X");
    getSourceText(b, "sources/a.md").insert(0, "Y");

    // exchange both directions
    const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    Y.applyUpdate(b, ua);
    Y.applyUpdate(a, ub);

    expect(loadSnapshot(a)).toEqual(loadSnapshot(b));
    expect(getBuildText(a).toString().startsWith("X")).toBe(true);
    expect(getSourceText(a, "sources/a.md").toString()).toBe("Yalpha");
  });

  it("setting a source via the live Y.Text reflects in the snapshot", () => {
    const doc = new Y.Doc();
    applySnapshot(doc, sample);
    getSourceText(doc, "sources/new.md").insert(0, "fresh");
    expect(loadSnapshot(doc).sources["sources/new.md"]).toBe("fresh");
  });
});

/**
 * Reconciling a *live* doc to disk (a branch switch / reload while clients are
 * connected) must touch only the bytes that actually changed. A blunt
 * delete-all + insert-all churns the whole Y.Text, which interleaves with
 * concurrent client edits (scrambling text) and needlessly destroys cursors.
 */
describe("applySnapshot minimal reconcile", () => {
  it("touches only the changed span — a 1-line edit does not churn the whole doc", () => {
    const doc = new Y.Doc();
    const body = "x".repeat(5000); // a big, unchanged middle/tail
    applySnapshot(doc, { buildMd: `head\n${body}\ntail`, sources: {} });

    let updateBytes = 0;
    const onUpdate = (u: Uint8Array): void => {
      updateBytes += u.length;
    };
    doc.on("update", onUpdate);
    // Only "head" -> "HEAD" changes; the 5000-char body + tail are identical.
    applySnapshot(doc, { buildMd: `HEAD\n${body}\ntail`, sources: {} });
    doc.off("update", onUpdate);

    expect(getBuildText(doc).toString()).toBe(`HEAD\n${body}\ntail`);
    // A whole-doc delete+insert would re-emit the 5000-char body (>5000 bytes).
    expect(updateBytes).toBeLessThan(200);
  });

  it("does not interleave with a concurrent client edit outside the changed region", () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    applySnapshot(server, { buildMd: "## t\nmodel: aaa\nfooter\n", sources: {} });
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server)); // client in sync

    // Client edits the footer (outside the model line) — not yet synced.
    const footerAt = "## t\nmodel: aaa\nfooter".length;
    getBuildText(client).insert(footerAt, "X"); // -> "...footerX\n"

    // Server reconciles to a new branch that only changes the model line.
    applySnapshot(server, { buildMd: "## t\nmodel: bbb\nfooter\n", sources: {} });

    // Exchange both directions.
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server, Y.encodeStateVector(client)));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));

    expect(loadSnapshot(server)).toEqual(loadSnapshot(client));
    // Clean merge: server's model change AND the client's footer edit, no scramble.
    expect(getBuildText(server).toString()).toBe("## t\nmodel: bbb\nfooterX\n");
  });

  it("reconciles to exactly the target content across prefix/suffix/middle/edge cases", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["abcXYZ", "ABCXYZ"], // prefix change
      ["abcXYZ", "abcDEF"], // suffix change
      ["abcMIDxyz", "abcNEWERxyz"], // middle change (grows)
      ["abcMIDDLExyz", "abcNxyz"], // middle change (shrinks)
      ["abcxyz", "abcINSxyz"], // pure insertion
      ["abcDELxyz", "abcxyz"], // pure deletion
      ["abc", "xyz"], // full change
      ["", "hello"], // empty -> content
      ["hello", ""], // content -> empty
      ["same", "same"], // identical (no-op)
      ["aaaa", "aa"], // repeated chars, prefix+suffix would overlap
      ["aaa", "aaaaa"], // repeated chars, growth
      ["PRE-longmiddle-SUF", "PRE-x-SUF"], // common prefix AND suffix
    ];
    for (const [from, to] of cases) {
      const doc = new Y.Doc();
      applySnapshot(doc, { buildMd: from, sources: {} });
      applySnapshot(doc, { buildMd: to, sources: {} });
      expect(getBuildText(doc).toString()).toBe(to);
    }
  });
});
