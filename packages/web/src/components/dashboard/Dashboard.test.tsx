import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "./Dashboard.js";
import type { ApiClient, Org } from "../../lib/api.js";
import type { AnalyticsResponse, AnalyticsSummary } from "../../lib/types.js";

const ORG: Org = { id: "org1", name: "Acme", slug: "acme" };

function fakeApi(over: Partial<ApiClient>): ApiClient {
  return {
    listOrgs: vi.fn().mockResolvedValue([ORG]),
    getAnalytics: vi.fn(),
    ...over,
  } as unknown as ApiClient;
}

const populated: AnalyticsSummary = {
  orgId: "org1",
  range: { from: null, to: null },
  totals: { tokensInput: 300, tokensOutput: 120, costUsd: 0.08, runs: 4 },
  byWorkspace: [{ key: "alpha", tokensInput: 300, tokensOutput: 120, costUsd: 0.08, runs: 4 }],
  byModel: [{ key: "claude-opus-4-8", tokensInput: 300, tokensOutput: 120, costUsd: 0.08, runs: 4 }],
  byTarget: [{ key: "summary", tokensInput: 300, tokensOutput: 120, costUsd: 0.08, runs: 4 }],
  byDay: [{ key: "2026-06-12", tokensInput: 300, tokensOutput: 120, costUsd: 0.08, runs: 4 }],
};

describe("Dashboard", () => {
  it("renders a single-tenant notice when the server has no index", async () => {
    const api = fakeApi({
      listOrgs: vi.fn().mockResolvedValue([]),
      getAnalytics: vi.fn().mockResolvedValue({ enabled: false } satisfies AnalyticsResponse),
    });
    render(<Dashboard api={api} />);
    expect(await screen.findByText(/team mode/i)).toBeInTheDocument();
    expect(screen.getByText(/DATABASE_URL/)).toBeInTheDocument();
  });

  it("renders totals and a model breakdown when populated", async () => {
    const api = fakeApi({
      getAnalytics: vi.fn().mockResolvedValue({ enabled: true, summary: populated } satisfies AnalyticsResponse),
    });
    render(<Dashboard api={api} />);
    // headline total-spend card
    expect(await screen.findByText("Total spend")).toBeInTheDocument();
    expect(screen.getAllByText("$0.0800").length).toBeGreaterThan(0);
    expect(screen.getByText("Artifacts produced")).toBeInTheDocument();
    // model breakdown shows the model key
    expect(screen.getByText("claude-opus-4-8")).toBeInTheDocument();
  });

  it("renders an empty state when there are no builds in range", async () => {
    const empty: AnalyticsSummary = {
      ...populated,
      totals: { tokensInput: 0, tokensOutput: 0, costUsd: 0, runs: 0 },
      byWorkspace: [],
      byModel: [],
      byTarget: [],
      byDay: [],
    };
    const api = fakeApi({
      getAnalytics: vi.fn().mockResolvedValue({ enabled: true, summary: empty } satisfies AnalyticsResponse),
    });
    render(<Dashboard api={api} />);
    expect(await screen.findByText(/no builds recorded/i)).toBeInTheDocument();
  });

  it("surfaces a load error instead of failing silently", async () => {
    const api = fakeApi({
      getAnalytics: vi.fn().mockRejectedValue(new Error("Server unreachable")),
    });
    render(<Dashboard api={api} />);
    expect(await screen.findByText(/Server unreachable/)).toBeInTheDocument();
  });
});
