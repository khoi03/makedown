import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { useActiveFile } from "./useActiveFile.js";

afterEach(cleanup);

function Probe({ paths }: { paths: readonly string[] }) {
  const { activeFile, openFile, requestOpen } = useActiveFile(paths);
  return (
    <div>
      <span data-testid="active">{activeFile}</span>
      <button onClick={() => openFile("sources/a.md")}>open-a</button>
      <button onClick={() => requestOpen("sources/late.md")}>request-late</button>
    </div>
  );
}

describe("useActiveFile", () => {
  it("starts on build.md", () => {
    render(<Probe paths={[]} />);
    expect(screen.getByTestId("active")).toHaveTextContent("build.md");
  });

  it("openFile switches to an existing source immediately", () => {
    render(<Probe paths={["sources/a.md"]} />);
    act(() => screen.getByText("open-a").click());
    expect(screen.getByTestId("active")).toHaveTextContent("sources/a.md");
  });

  it("requestOpen waits until the path appears, then opens it", () => {
    const { rerender } = render(<Probe paths={[]} />);
    act(() => screen.getByText("request-late").click());
    // Not present yet — stays on build.md.
    expect(screen.getByTestId("active")).toHaveTextContent("build.md");

    // The source syncs in -> it becomes active.
    rerender(<Probe paths={["sources/late.md"]} />);
    expect(screen.getByTestId("active")).toHaveTextContent("sources/late.md");
  });

  it("falls back to build.md when the open source disappears", () => {
    const { rerender } = render(<Probe paths={["sources/a.md"]} />);
    act(() => screen.getByText("open-a").click());
    expect(screen.getByTestId("active")).toHaveTextContent("sources/a.md");

    rerender(<Probe paths={[]} />);
    expect(screen.getByTestId("active")).toHaveTextContent("build.md");
  });
});
