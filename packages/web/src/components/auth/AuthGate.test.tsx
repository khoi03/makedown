import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthGate } from "./AuthGate.js";
import { AccountMenu } from "./AccountMenu.js";
import type { ApiClient, AuthUser } from "../../lib/api.js";

/**
 * The gate must be invisible on a single-tenant server (no login wall, original
 * behavior) and only interpose a sign-in screen when auth is enabled and no
 * session exists. These three states are the contract.
 */
function fakeApi(over: Partial<ApiClient>): ApiClient {
  return {
    getTenancy: vi.fn().mockResolvedValue({ enabled: false }),
    getSession: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ApiClient;
}

describe("AuthGate", () => {
  it("renders children unchanged when tenancy is disabled (AccountMenu shows nothing)", async () => {
    const api = fakeApi({ getTenancy: vi.fn().mockResolvedValue({ enabled: false }) });
    render(
      <AuthGate api={api}>
        <AccountMenu />
        <div>workbench</div>
      </AuthGate>,
    );
    expect(await screen.findByText("workbench")).toBeInTheDocument();
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows the sign-in screen when enabled and unauthenticated", async () => {
    const api = fakeApi({
      getTenancy: vi.fn().mockResolvedValue({ enabled: true }),
      getSession: vi.fn().mockResolvedValue(undefined),
    });
    render(
      <AuthGate api={api}>
        <div>workbench</div>
      </AuthGate>,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("workbench")).not.toBeInTheDocument();
  });

  it("provides the account to in-flow chrome (AccountMenu) when authenticated", async () => {
    const user: AuthUser = { id: "u1", email: "owner@example.com" };
    const api = fakeApi({
      getTenancy: vi.fn().mockResolvedValue({ enabled: true }),
      getSession: vi.fn().mockResolvedValue(user),
    });
    render(
      <AuthGate api={api}>
        <AccountMenu />
        <div>workbench</div>
      </AuthGate>,
    );
    expect(await screen.findByText("workbench")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("falls open to children when the tenancy probe fails (older server)", async () => {
    const api = fakeApi({ getTenancy: vi.fn().mockRejectedValue(new Error("404")) });
    render(
      <AuthGate api={api}>
        <div>workbench</div>
      </AuthGate>,
    );
    expect(await screen.findByText("workbench")).toBeInTheDocument();
  });
});
