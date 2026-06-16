import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SourcesPanel } from "./SourcesPanel.js";

afterEach(cleanup);

describe("SourcesPanel", () => {
  it("always lists build.md as the first, pinned file", () => {
    render(<SourcesPanel paths={[]} activeFile="build.md" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /build\.md/ })).toBeInTheDocument();
  });

  it("lists each source path", () => {
    render(
      <SourcesPanel paths={["sources/a.md", "sources/b.md"]} activeFile="build.md" onOpen={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /sources\/a\.md/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sources\/b\.md/ })).toBeInTheDocument();
  });

  it("marks the active file with aria-current", () => {
    render(
      <SourcesPanel paths={["sources/a.md"]} activeFile="sources/a.md" onOpen={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /sources\/a\.md/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /build\.md/ })).not.toHaveAttribute("aria-current", "true");
  });

  it("calls onOpen with the path when a source is clicked", () => {
    const onOpen = vi.fn();
    render(<SourcesPanel paths={["sources/a.md"]} activeFile="build.md" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /sources\/a\.md/ }));
    expect(onOpen).toHaveBeenCalledWith("sources/a.md");
  });

  it("calls onOpen with build.md when build.md is clicked", () => {
    const onOpen = vi.fn();
    render(<SourcesPanel paths={["sources/a.md"]} activeFile="sources/a.md" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /build\.md/ }));
    expect(onOpen).toHaveBeenCalledWith("build.md");
  });

  it("shows an empty-state hint when there are no sources", () => {
    render(<SourcesPanel paths={[]} activeFile="build.md" onOpen={vi.fn()} />);
    expect(screen.getByText(/no sources yet/i)).toBeInTheDocument();
  });
});
