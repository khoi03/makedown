/**
 * Typed HTTP client for the Makedown server. A thin wrapper over `fetch` that
 * maps the REST surface to methods, returns parsed JSON, treats 404 on artifact
 * reads as "not built" (undefined), and throws {@link ApiError} otherwise.
 */
import type {
  ArtifactView,
  BranchInfo,
  BuildCost,
  GraphView,
  Provenance,
  Snapshot,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchFn = typeof fetch;

export class ApiClient {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly baseUrl = "",
    fetchFn?: FetchFn,
  ) {
    // The native `fetch` must be called with `this === Window`/`globalThis`.
    // Stored as a class field and called as `this.fetchFn(...)`, an unbound
    // reference would have `this === ApiClient` → "Illegal invocation". Bind it.
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** Base URL for the build-events SSE stream (consumed via EventSource). */
  buildEventsUrl(jobId: string): string {
    return `${this.baseUrl}/api/builds/${encodeURIComponent(jobId)}/events`;
  }

  /**
   * Base WebSocket URL for collaborative sync. y-websocket's WebsocketProvider
   * appends `/<room>` (the workspace id), matching the server's `/sync/<id>`.
   */
  syncBaseUrl(): string {
    const httpBase = this.baseUrl || window.location.origin;
    return `${httpBase.replace(/^http/, "ws")}/sync`;
  }

  async listWorkspaces(): Promise<string[]> {
    const { workspaces } = await this.get<{ workspaces: string[] }>("/api/workspaces");
    return workspaces;
  }

  getGraph(workspaceId: string): Promise<GraphView> {
    return this.get<GraphView>(`/api/workspaces/${enc(workspaceId)}/graph`);
  }

  getCost(workspaceId: string): Promise<BuildCost> {
    return this.get<BuildCost>(`/api/workspaces/${enc(workspaceId)}/cost`);
  }

  async startBuild(workspaceId: string): Promise<string> {
    const { jobId } = await this.post<{ jobId: string }>(`/api/workspaces/${enc(workspaceId)}/build`);
    return jobId;
  }

  /** Returns the artifact, or `undefined` when it has not been built (404). */
  async getArtifact(workspaceId: string, target: string): Promise<ArtifactView | undefined> {
    return this.getOrUndefined<ArtifactView>(
      `/api/workspaces/${enc(workspaceId)}/artifacts/${enc(target)}`,
    );
  }

  getProvenance(workspaceId: string, target: string): Promise<Provenance | undefined> {
    return this.getOrUndefined<Provenance>(
      `/api/workspaces/${enc(workspaceId)}/artifacts/${enc(target)}/why`,
    );
  }

  resolveApproval(jobId: string, approvalId: string, approved: boolean): Promise<{ resolved: boolean }> {
    return this.post(`/api/builds/${enc(jobId)}/approvals/${enc(approvalId)}`, { approved });
  }

  async listSnapshots(workspaceId: string): Promise<Snapshot[]> {
    const { snapshots } = await this.get<{ snapshots: Snapshot[] }>(
      `/api/workspaces/${enc(workspaceId)}/snapshots`,
    );
    return snapshots;
  }

  createSnapshot(workspaceId: string, message: string): Promise<{ sha: string }> {
    return this.post(`/api/workspaces/${enc(workspaceId)}/snapshots`, { message });
  }

  getBranches(workspaceId: string): Promise<BranchInfo> {
    return this.get<BranchInfo>(`/api/workspaces/${enc(workspaceId)}/branches`);
  }

  switchBranch(workspaceId: string, name: string, create = false): Promise<{ current: string }> {
    return this.post(`/api/workspaces/${enc(workspaceId)}/branches`, { name, create });
  }

  // --- internals -----------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private async getOrUndefined<T>(path: string): Promise<T | undefined> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, { method: "GET" });
    if (res.status === 404) return undefined;
    return this.parse<T>(res);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.ok) return (await res.json()) as T;
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new ApiError(message, res.status);
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
