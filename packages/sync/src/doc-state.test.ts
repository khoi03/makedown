import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import { saveDocState, restoreDocState, docStatePath } from "./doc-state.js";
import { applySnapshot, loadSnapshot } from "./doc-model.js";

describe("the Yjs load-text anti-pattern (why doc-state exists)", () => {
  it("DEMONSTRATES the bug: two independent docs that each insert the same text merge to duplicate it", () => {
    const a = new Y.Doc();
    a.getText("build.md").insert(0, "CONTENT");
    const b = new Y.Doc();
    b.getText("build.md").insert(0, "CONTENT"); // independent insert, different history

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); // sync — merges both inserts
    expect(a.getText("build.md").toString()).toBe("CONTENTCONTENT"); // duplicated!
  });

  it("is AVOIDED when the second doc is restored from the first's state (shared history)", () => {
    const a = new Y.Doc();
    a.getText("build.md").insert(0, "CONTENT");
    const state = Y.encodeStateAsUpdate(a);

    const b = new Y.Doc();
    Y.applyUpdate(b, state); // restore — same history, not an independent insert

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText("build.md").toString()).toBe("CONTENT"); // no duplication
    expect(b.getText("build.md").toString()).toBe("CONTENT");
  });
});

describe("saveDocState / restoreDocState", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdstate-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns false when there is no saved state", async () => {
    expect(await restoreDocState(new Y.Doc(), dir)).toBe(false);
  });

  it("round-trips a doc's content through save -> restore without duplication", async () => {
    const original = new Y.Doc();
    applySnapshot(original, { buildMd: "## target: t\nbody", sources: { "sources/a.md": "alpha" } });
    await saveDocState(original, dir);

    const restored = new Y.Doc();
    expect(await restoreDocState(restored, dir)).toBe(true);
    expect(loadSnapshot(restored)).toEqual(loadSnapshot(original));
  });

  it("repeated restore-then-sync stays idempotent (no compounding)", async () => {
    const server = new Y.Doc();
    server.getText("build.md").insert(0, "spec");
    await saveDocState(server, dir);

    // Simulate three reconnect cycles: each time a fresh doc restores + syncs back.
    for (let i = 0; i < 3; i++) {
      const reopened = new Y.Doc();
      await restoreDocState(reopened, dir);
      Y.applyUpdate(server, Y.encodeStateAsUpdate(reopened));
      await saveDocState(server, dir);
    }
    expect(server.getText("build.md").toString()).toBe("spec"); // not "specspecspec…"
  });

  it("writes the state under the gitignored .makedown directory", () => {
    expect(docStatePath(dir).replaceAll("\\", "/")).toContain("/.makedown/sync/ydoc.bin");
  });
});
