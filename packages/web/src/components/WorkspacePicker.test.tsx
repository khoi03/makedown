import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient } from "../lib/api.js";
import { WorkspacePicker } from "./WorkspacePicker.js";

/** A URL-aware fake: each endpoint returns its own body. */
function clientFor(routes: Record<string, unknown>, fallbackStatus = 200): ApiClient {
  const fetchFn = (async (url: string) => {
    // Longest-prefix match so "/api/workspaces/available" wins over "/api/workspaces".
    const key = Object.keys(routes)
      .filter((p) => url.includes(p))
      .sort((a, b) => b.length - a.length)[0];
    const body = key ? routes[key] : { workspaces: [] };
    return { ok: fallbackStatus < 400, status: fallbackStatus, json: async () => body };
  }) as unknown as typeof fetch;
  return new ApiClient("", fetchFn);
}

describe("WorkspacePicker", () => {
  it("lists workspaces and calls onPick on selection", async () => {
    const onPick = vi.fn();
    render(
      <WorkspacePicker
        api={clientFor({
          "/api/workspaces/available": { workspaces: [] },
          "/api/orgs": { orgs: [] },
          "/api/workspaces": { workspaces: ["alpha", "beta"] },
        })}
        onPick={onPick}
      />,
    );
    const item = await screen.findByRole("button", { name: /alpha/ });
    await userEvent.click(item);
    expect(onPick).toHaveBeenCalledWith("alpha");
  });

  it("shows an empty-state hint when there are no workspaces", async () => {
    render(
      <WorkspacePicker
        api={clientFor({
          "/api/workspaces/available": { workspaces: [] },
          "/api/orgs": { orgs: [] },
          "/api/workspaces": { workspaces: [] },
        })}
        onPick={vi.fn()}
      />,
    );
    expect(await screen.findByText(/No workspaces found/i)).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    render(
      <WorkspacePicker api={clientFor({ "/api/workspaces": { error: "boom" } }, 500)} onPick={vi.fn()} />,
    );
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("offers claimable workspaces in team mode and registers one on click", async () => {
    const registerWorkspace = vi.fn().mockResolvedValue(undefined);
    const api = clientFor({
      "/api/workspaces/available": { workspaces: ["quickstart"] },
      "/api/orgs": { orgs: [{ id: "org1", name: "Acme", slug: "acme" }] },
      "/api/workspaces": { workspaces: [] },
    });
    // spy on the register call (the rest still flows through the URL-aware fake)
    (api as unknown as { registerWorkspace: typeof registerWorkspace }).registerWorkspace =
      registerWorkspace;

    render(<WorkspacePicker api={api} onPick={vi.fn()} />);

    expect(await screen.findByText(/Add to/)).toBeInTheDocument();
    const addBtn = await screen.findByRole("button", { name: /quickstart/ });
    await userEvent.click(addBtn);
    expect(registerWorkspace).toHaveBeenCalledWith("org1", "quickstart");
  });
});
