/**
 * Typed HTTP client for the Makedown server. A thin wrapper over `fetch` that
 * maps the REST surface to methods, returns parsed JSON, treats 404 on artifact
 * reads as "not built" (undefined), and throws {@link ApiError} otherwise.
 */
import type {
  ArtifactView,
  BranchInfo,
  BuildCost,
  CreatedShare,
  GraphView,
  Provenance,
  ShareSummary,
  Snapshot,
} from "./types.js";

export type { CreatedShare, ShareSummary } from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A user account (never includes the password hash). */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
}

/** An organization the user belongs to. */
export interface Org {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** The result of a successful signup/login. */
export interface AuthSession {
  readonly user: AuthUser;
  readonly org: Org;
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
   *
   * In dev this points directly at the server (`__SYNC_ORIGIN__`, injected by
   * Vite) to bypass the unreliable ws proxy; otherwise it falls back to the
   * client's own origin (same-origin production deploy).
   */
  syncBaseUrl(): string {
    const injected = typeof __SYNC_ORIGIN__ !== "undefined" ? __SYNC_ORIGIN__ : "";
    const httpBase = injected || this.baseUrl || window.location.origin;
    return `${httpBase.replace(/^http/, "ws")}/sync`;
  }

  // --- tenancy / auth (no-ops on a single-tenant server) -------------------

  /** Whether the server has auth/RBAC enabled. */
  getTenancy(): Promise<{ enabled: boolean }> {
    return this.get<{ enabled: boolean }>("/api/tenancy");
  }

  /** The signed-in user, or `undefined` when not authenticated (401). */
  async getSession(): Promise<AuthUser | undefined> {
    const res = await this.fetchFn(`${this.baseUrl}/api/auth/me`, {
      method: "GET",
      credentials: "include",
    });
    if (res.status === 401) return undefined;
    const body = await this.parse<{ user: AuthUser }>(res);
    return body.user;
  }

  signup(email: string, password: string): Promise<AuthSession> {
    return this.post<AuthSession>("/api/auth/signup", { email, password });
  }

  login(email: string, password: string): Promise<AuthSession> {
    return this.post<AuthSession>("/api/auth/login", { email, password });
  }

  async logout(): Promise<void> {
    await this.post("/api/auth/logout");
  }

  async listOrgs(): Promise<Org[]> {
    const { orgs } = await this.get<{ orgs: Org[] }>("/api/orgs");
    return orgs;
  }

  async registerWorkspace(orgId: string, workspaceId: string): Promise<void> {
    await this.post(`/api/orgs/${enc(orgId)}/workspaces`, { workspaceId });
  }

  async listWorkspaces(): Promise<string[]> {
    const { workspaces } = await this.get<{ workspaces: string[] }>("/api/workspaces");
    return workspaces;
  }

  /** On-disk workspaces not yet claimed by any org (empty on a single-tenant server). */
  async listAvailableWorkspaces(): Promise<string[]> {
    const { workspaces } = await this.get<{ workspaces: string[] }>("/api/workspaces/available");
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

  /** Create a public read-only link to a built artifact. */
  createShare(
    workspaceId: string,
    target: string,
    opts: { includeProvenance?: boolean; expiresInDays?: number } = {},
  ): Promise<CreatedShare> {
    return this.post<CreatedShare>(
      `/api/workspaces/${enc(workspaceId)}/artifacts/${enc(target)}/share`,
      opts,
    );
  }

  async listShares(workspaceId: string): Promise<ShareSummary[]> {
    const { shares } = await this.get<{ shares: ShareSummary[] }>(
      `/api/workspaces/${enc(workspaceId)}/shares`,
    );
    return shares;
  }

  async revokeShare(shareId: string): Promise<void> {
    await this.request(`/api/shares/${enc(shareId)}`, { method: "DELETE" });
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
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "GET",
      credentials: "include",
    });
    if (res.status === 404) return undefined;
    return this.parse<T>(res);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    // Only declare a JSON body when there actually is one. A POST with
    // `content-type: application/json` and an empty body is rejected by Fastify
    // (FST_ERR_CTP_EMPTY_JSON_BODY) — which is what `startBuild` (bodyless) hit.
    const hasBody = body !== undefined;
    return this.request<T>(path, {
      method: "POST",
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    // Always include credentials so the session cookie rides along (a no-op for
    // a single-tenant server that sets no cookie).
    const res = await this.fetchFn(`${this.baseUrl}${path}`, { credentials: "include", ...init });
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
