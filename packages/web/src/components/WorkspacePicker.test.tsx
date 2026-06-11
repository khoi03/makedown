import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient } from "../lib/api.js";
import { WorkspacePicker } from "./WorkspacePicker.js";

function clientReturning(body: unknown, status = 200): ApiClient {
  const fetchFn = (async () => ({
    ok: status < 400,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  return new ApiClient("", fetchFn);
}

describe("WorkspacePicker", () => {
  it("lists workspaces and calls onPick on selection", async () => {
    const onPick = vi.fn();
    render(<WorkspacePicker api={clientReturning({ workspaces: ["alpha", "beta"] })} onPick={onPick} />);

    const item = await screen.findByRole("button", { name: /alpha/ });
    await userEvent.click(item);
    expect(onPick).toHaveBeenCalledWith("alpha");
  });

  it("shows an empty-state hint when there are no workspaces", async () => {
    render(<WorkspacePicker api={clientReturning({ workspaces: [] })} onPick={vi.fn()} />);
    expect(await screen.findByText(/No workspaces found/i)).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    render(<WorkspacePicker api={clientReturning({ error: "boom" }, 500)} onPick={vi.fn()} />);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
