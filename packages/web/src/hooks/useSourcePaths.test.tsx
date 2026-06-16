import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import * as Y from "yjs";
import { useSourcePaths } from "./useSourcePaths.js";
import { sourceText } from "../lib/doc.js";

afterEach(cleanup);

function Probe({ doc }: { doc: Y.Doc }) {
  const paths = useSourcePaths(doc);
  return <ul data-testid="paths">{paths.map((p) => <li key={p}>{p}</li>)}</ul>;
}

describe("useSourcePaths", () => {
  it("returns the current source paths", () => {
    const doc = new Y.Doc();
    sourceText(doc, "sources/a.md");
    render(<Probe doc={doc} />);
    expect(screen.getByText("sources/a.md")).toBeInTheDocument();
  });

  it("re-renders when a source is added to the live doc", () => {
    const doc = new Y.Doc();
    render(<Probe doc={doc} />);
    expect(screen.queryByText("sources/new.md")).not.toBeInTheDocument();

    act(() => {
      sourceText(doc, "sources/new.md").insert(0, "x");
    });
    expect(screen.getByText("sources/new.md")).toBeInTheDocument();
  });

  it("re-renders when a source is removed", () => {
    const doc = new Y.Doc();
    sourceText(doc, "sources/gone.md");
    render(<Probe doc={doc} />);
    expect(screen.getByText("sources/gone.md")).toBeInTheDocument();

    act(() => {
      doc.getMap("sources").delete("sources/gone.md");
    });
    expect(screen.queryByText("sources/gone.md")).not.toBeInTheDocument();
  });
});
