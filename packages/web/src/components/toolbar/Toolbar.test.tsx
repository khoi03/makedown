import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "./Toolbar.js";

function setup(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const props = {
    workspaceId: "demo",
    connection: "connected" as const,
    branch: "main",
    peers: [],
    building: false,
    onBuild: vi.fn(),
    onSnapshot: vi.fn(),
    onSwitchBranch: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<Toolbar {...props} />);
  return props;
}

describe("Toolbar", () => {
  it("invokes onBuild when the build button is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /build/i }));
    expect(props.onBuild).toHaveBeenCalledOnce();
  });

  it("disables the build button and shows progress while building", () => {
    setup({ building: true });
    const btn = screen.getByRole("button", { name: /building/i });
    expect(btn).toBeDisabled();
  });

  it("invokes branch + snapshot handlers", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /main/ }));
    await userEvent.click(screen.getByRole("button", { name: /snapshot/i }));
    expect(props.onSwitchBranch).toHaveBeenCalledOnce();
    expect(props.onSnapshot).toHaveBeenCalledOnce();
  });

  it("returns to the workspace picker when the brand is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /workspaces/i }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("renders collaborator presence initials", () => {
    setup({ peers: [{ name: "Ada Lovelace", color: "#f0f" }] });
    expect(screen.getByTitle("Ada Lovelace")).toHaveTextContent("A");
  });
});
