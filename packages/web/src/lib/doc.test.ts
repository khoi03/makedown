import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { BUILD_FILE, fileText, sourcePaths, sourceText } from "./doc.js";

describe("doc helpers", () => {
  it("sourcePaths lists the source map keys, sorted", () => {
    const doc = new Y.Doc();
    sourceText(doc, "sources/b.md").insert(0, "b");
    sourceText(doc, "sources/a.md").insert(0, "a");
    expect(sourcePaths(doc)).toEqual(["sources/a.md", "sources/b.md"]);
  });

  it("sourcePaths is empty for a fresh doc", () => {
    expect(sourcePaths(new Y.Doc())).toEqual([]);
  });

  it("sourceText returns the same live Y.Text for a path across calls", () => {
    const doc = new Y.Doc();
    const first = sourceText(doc, "sources/x.md");
    first.insert(0, "hello");
    expect(sourceText(doc, "sources/x.md").toString()).toBe("hello");
  });

  it("fileText maps build.md to the top-level build text", () => {
    const doc = new Y.Doc();
    doc.getText("build.md").insert(0, "## target: x");
    expect(fileText(doc, BUILD_FILE).toString()).toBe("## target: x");
  });

  it("fileText maps a source path to its source text", () => {
    const doc = new Y.Doc();
    sourceText(doc, "sources/r.md").insert(0, "report");
    expect(fileText(doc, "sources/r.md").toString()).toBe("report");
  });
});
