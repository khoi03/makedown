import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { EditorPane } from "./EditorPane.js";

afterEach(cleanup);

const BUILD = `## target: sonnet
model: "anthropic:cc/claude-sonnet-4-6"
cache: deterministic
`;

/** Mimic the server delivering a workspace's content to a fresh browser doc. */
function syncFromServer(into: Y.Doc, content: string): void {
  const server = new Y.Doc();
  server.getText("build.md").insert(0, content);
  Y.applyUpdate(into, Y.encodeStateAsUpdate(server));
}

describe("EditorPane binding (reload-scramble repro)", () => {
  it("does not duplicate content when sync arrives AFTER the editor mounts", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    render(<EditorPane text={doc.getText("build.md")} awareness={awareness} />);
    syncFromServer(doc, BUILD);
    expect(doc.getText("build.md").toString()).toBe(BUILD);
  });

  it("does not duplicate content when the editor mounts AFTER sync", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    syncFromServer(doc, BUILD);
    render(<EditorPane text={doc.getText("build.md")} awareness={awareness} />);
    expect(doc.getText("build.md").toString()).toBe(BUILD);
  });

  it("binds to an arbitrary Y.Text (a source), not just build.md", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const source = doc.getMap<Y.Text>("sources").set("sources/r.md", new Y.Text());
    source.insert(0, "# Report");
    render(<EditorPane text={source} awareness={awareness} />);
    expect(screen.getByText("# Report")).toBeInTheDocument();
  });

  it("writes an editor edit back to the Y.Text at the correct position (no scramble)", () => {
    // Replicate EditorPane's exact setup so we control the view + dispatch an edit.
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    syncFromServer(doc, BUILD);
    const ytext = doc.getText("build.md");

    const view = new EditorView({
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [basicSetup, yCollab(ytext, awareness)],
      }),
    });

    try {
      // User replaces "sonnet" with "opus" in the model line.
      const at = BUILD.indexOf("claude-sonnet-4-6") + "claude-".length; // start of "sonnet"
      view.dispatch({ changes: { from: at, to: at + "sonnet".length, insert: "opus" } });

      const expected = BUILD.replace("claude-sonnet-4-6", "claude-opus-4-6");
      expect(view.state.doc.toString()).toBe(expected);
      expect(ytext.toString()).toBe(expected);
    } finally {
      view.destroy();
    }
  });
});
