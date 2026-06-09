import { describe, it, expect } from "vitest";
import { parseBuildDoc } from "@makedown/format";
import { buildGraph, GraphError } from "./graph.js";

const target = (name: string, inputs: string[], body: string) =>
  `## target: ${name}\n\`\`\`yaml\ninputs: [${inputs.join(", ")}]\n\`\`\`\n${body}\n`;

describe("buildGraph", () => {
  it("orders dependencies first and classifies inputs", () => {
    const doc = parseBuildDoc(
      target("a", ["sources/x.md"], "use {{sources/x.md}}") +
        "\n" +
        target("b", ["a"], "use {{a}}"),
    );
    const g = buildGraph(doc);
    expect(g.order).toEqual(["a", "b"]);
    expect(g.nodes.get("b")!.deps).toEqual(["a"]);
    expect(g.nodes.get("a")!.sources).toEqual(["sources/x.md"]);
    expect(g.nodes.get("a")!.deps).toEqual([]);
  });

  it("detects dependency cycles", () => {
    const doc = parseBuildDoc(
      target("a", ["b"], "use {{b}}") + "\n" + target("b", ["a"], "use {{a}}"),
    );
    expect(() => buildGraph(doc)).toThrow(GraphError);
  });
});
