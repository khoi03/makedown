import { describe, it, expect } from "vitest";
import { layoutGraph } from "./graph-layout.js";
import type { GraphView, GraphTargetView } from "./types.js";

function target(name: string, deps: string[] = []): GraphTargetView {
  return { name, step: "chat", stale: true, id: `sha256:${name}`, output: `artifacts/${name}.md`, deps, inputs: [] };
}

describe("layoutGraph", () => {
  it("returns empty nodes and edges for an empty graph", () => {
    const out = layoutGraph({ order: [], targets: [] });
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it("assigns increasing layers along a linear chain", () => {
    const graph: GraphView = {
      order: ["a", "b", "c"],
      targets: [target("a"), target("b", ["a"]), target("c", ["b"])],
    };
    const { nodes, edges } = layoutGraph(graph);
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x;
    expect(x("a")).toBeLessThan(x("b"));
    expect(x("b")).toBeLessThan(x("c"));
    expect(edges).toEqual([
      { id: "a->b", source: "a", target: "b" },
      { id: "b->c", source: "b", target: "c" },
    ]);
  });

  it("places a diamond's join node two layers deep", () => {
    const graph: GraphView = {
      order: ["a", "b", "c", "d"],
      targets: [target("a"), target("b", ["a"]), target("c", ["a"]), target("d", ["b", "c"])],
    };
    const { nodes } = layoutGraph(graph);
    const layerOf = (id: string) => nodes.find((n) => n.id === id)!.data.layer;
    expect(layerOf("a")).toBe(0);
    expect(layerOf("b")).toBe(1);
    expect(layerOf("c")).toBe(1);
    expect(layerOf("d")).toBe(2);
  });

  it("carries the target payload and separates same-layer nodes vertically", () => {
    const graph: GraphView = {
      order: ["a", "b", "c"],
      targets: [target("a"), target("b", ["a"]), target("c", ["a"])],
    };
    const { nodes } = layoutGraph(graph);
    expect(nodes.find((n) => n.id === "a")!.data.target.name).toBe("a");
    const yB = nodes.find((n) => n.id === "b")!.position.y;
    const yC = nodes.find((n) => n.id === "c")!.position.y;
    expect(yB).not.toBe(yC);
  });
});
