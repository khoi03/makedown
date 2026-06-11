import { afterEach, describe, it, expect, vi } from "vitest";
import { ApiClient, ApiError } from "./api.js";

function mockFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("ApiClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls the global fetch with its native binding (regression: Illegal invocation)", async () => {
    // Native fetch throws "Illegal invocation" if called with a `this` that is
    // not the global object. Simulate that and construct ApiClient with no
    // injected fetch so the default path is exercised.
    const original = globalThis.fetch;
    function picky(this: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ workspaces: ["ws"] }),
      } as Response);
    }
    globalThis.fetch = picky as unknown as typeof fetch;
    try {
      const api = new ApiClient();
      expect(await api.listWorkspaces()).toEqual(["ws"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("lists workspaces", async () => {
    const { fn, calls } = mockFetch([{ body: { workspaces: ["a", "b"] } }]);
    const api = new ApiClient("", fn);
    expect(await api.listWorkspaces()).toEqual(["a", "b"]);
    expect(calls[0]?.url).toBe("/api/workspaces");
  });

  it("fetches a workspace graph", async () => {
    const graph = { order: ["t"], targets: [{ name: "t" }] };
    const { fn, calls } = mockFetch([{ body: graph }]);
    const api = new ApiClient("", fn);
    expect(await api.getGraph("ws")).toEqual(graph);
    expect(calls[0]?.url).toBe("/api/workspaces/ws/graph");
  });

  it("starts a build and returns the job id", async () => {
    const { fn, calls } = mockFetch([{ status: 202, body: { jobId: "job-1" } }]);
    const api = new ApiClient("", fn);
    expect(await api.startBuild("ws")).toBe("job-1");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("sends a bodyless POST WITHOUT a JSON content-type (regression: empty JSON body 500)", async () => {
    const { fn, calls } = mockFetch([{ status: 202, body: { jobId: "j" } }]);
    const api = new ApiClient("", fn);
    await api.startBuild("ws");
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("resolves an approval with a JSON body", async () => {
    const { fn, calls } = mockFetch([{ body: { resolved: true } }]);
    const api = new ApiClient("", fn);
    await api.resolveApproval("job-1", "appr-1", true);
    expect(calls[0]?.url).toBe("/api/builds/job-1/approvals/appr-1");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ approved: true });
  });

  it("creates a snapshot", async () => {
    const { fn } = mockFetch([{ status: 201, body: { sha: "abc" } }]);
    const api = new ApiClient("", fn);
    expect(await api.createSnapshot("ws", "msg")).toEqual({ sha: "abc" });
  });

  it("returns undefined for a 404 artifact (not built) rather than throwing", async () => {
    const { fn } = mockFetch([{ status: 404, body: { error: "Artifact not built" } }]);
    const api = new ApiClient("", fn);
    expect(await api.getArtifact("ws", "t")).toBeUndefined();
  });

  it("throws ApiError with the server message on other failures", async () => {
    const { fn } = mockFetch([{ status: 400, body: { error: "Invalid workspace id" } }]);
    const api = new ApiClient("", fn);
    await expect(api.getGraph("..")).rejects.toThrowError(ApiError);
    await expect(api.getGraph("..")).rejects.toThrow("Invalid workspace id");
  });

  it("switches a branch", async () => {
    const { fn, calls } = mockFetch([{ body: { current: "experiment" } }]);
    const api = new ApiClient("", fn);
    expect(await api.switchBranch("ws", "experiment", true)).toEqual({ current: "experiment" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ name: "experiment", create: true });
  });
});
