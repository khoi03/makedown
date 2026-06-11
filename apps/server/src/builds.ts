/**
 * Build orchestration.
 *
 * A build runs off the request thread: `start` returns immediately with a job,
 * `runBuild` runs in the background, and per-target {@link BuildEvent}s are
 * captured and fanned out to subscribers (the SSE route). The engine's approval
 * callback is bridged to a pending-approval registry an HTTP route resolves —
 * this is how a human approves an `agent` artifact from the web UI.
 */
import { randomUUID } from "node:crypto";
import {
  runBuild,
  type BuildContext,
  type BuildEvent,
  type BuildResult,
  type ApprovalRequest,
} from "@makedown/engine";
import type { BuildDoc } from "@makedown/shared";

export type BuildJobStatus = "running" | "succeeded" | "failed";

/** A pending approval awaiting a human decision. */
export interface PendingApproval {
  readonly id: string;
  readonly jobId: string;
  readonly target: string;
  readonly output: string;
  readonly preview: string;
  readonly step: ApprovalRequest["step"];
}

/** Events streamed to a build subscriber (serialized over SSE). */
export type BuildStreamEvent =
  | { readonly type: "progress"; readonly event: BuildEvent }
  | { readonly type: "approval-pending"; readonly approval: PendingApproval }
  | {
      readonly type: "done";
      readonly built: readonly string[];
      readonly reused: readonly string[];
      readonly rejected: readonly string[];
    }
  | { readonly type: "error"; readonly message: string };

export interface BuildJob {
  readonly id: string;
  readonly workspaceId: string;
  status: BuildJobStatus;
  result?: BuildResult;
  error?: string;
  readonly startedAt: string;
  finishedAt?: string;
}

/** Hooks the manager injects into a caller-provided context factory. */
export interface ContextHooks {
  readonly onProgress: (event: BuildEvent) => void;
  readonly approve: (request: ApprovalRequest) => Promise<boolean>;
}

export interface StartBuildOptions {
  readonly workspaceId: string;
  readonly doc: BuildDoc;
  /** Build a {@link BuildContext} wired with the manager's hooks. */
  readonly makeContext: (hooks: ContextHooks) => BuildContext;
}

export interface BuildManagerOptions {
  /** Auto-deny a pending approval after this many ms. Default: no timeout. */
  readonly approvalTimeoutMs?: number;
}

type Listener = (event: BuildStreamEvent) => void;

interface JobState {
  readonly job: BuildJob;
  readonly history: BuildStreamEvent[];
  readonly listeners: Set<Listener>;
  done: Promise<BuildJob>;
}

interface PendingState {
  readonly approval: PendingApproval;
  resolve(approved: boolean): void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Runs builds in the background and brokers their progress + approvals. */
export class BuildManager {
  private readonly jobs = new Map<string, JobState>();
  private readonly pending = new Map<string, PendingState>();

  constructor(private readonly opts: BuildManagerOptions = {}) {}

  /** Kick off a build. Returns the job immediately (status `running`). */
  start(opts: StartBuildOptions): BuildJob {
    const job: BuildJob = {
      id: randomUUID(),
      workspaceId: opts.workspaceId,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    const state: JobState = {
      job,
      history: [],
      listeners: new Set(),
      done: Promise.resolve(job), // replaced below; run() closes over this same state
    };
    this.jobs.set(job.id, state);
    state.done = this.run(state, opts); // resolves when the background run settles
    return job;
  }

  get(jobId: string): BuildJob | undefined {
    return this.jobs.get(jobId)?.job;
  }

  list(workspaceId?: string): BuildJob[] {
    const all = [...this.jobs.values()].map((s) => s.job);
    return workspaceId ? all.filter((j) => j.workspaceId === workspaceId) : all;
  }

  /** Await a job's completion (resolves even on failure). */
  async wait(jobId: string): Promise<BuildJob> {
    const state = this.jobs.get(jobId);
    if (!state) throw new Error(`Unknown build job: ${jobId}`);
    return state.done;
  }

  /**
   * Subscribe to a job's stream. Past events are replayed synchronously so a
   * late subscriber (e.g. an SSE reconnect) catches up, then receives live ones.
   * Returns an unsubscribe function.
   */
  subscribe(jobId: string, listener: Listener): () => void {
    const state = this.jobs.get(jobId);
    if (!state) return () => {};
    for (const event of state.history) listener(event);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  pendingApprovals(jobId?: string): PendingApproval[] {
    const all = [...this.pending.values()].map((p) => p.approval);
    return jobId ? all.filter((a) => a.jobId === jobId) : all;
  }

  /** Resolve a pending approval. Returns false if the id is unknown. */
  resolveApproval(approvalId: string, approved: boolean): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(approvalId);
    pending.resolve(approved);
    return true;
  }

  private emit(state: JobState, event: BuildStreamEvent): void {
    state.history.push(event);
    for (const listener of state.listeners) listener(event);
  }

  private async run(state: JobState, opts: StartBuildOptions): Promise<BuildJob> {
    const { job } = state;
    try {
      const ctx = opts.makeContext({
        onProgress: (event) => this.emit(state, { type: "progress", event }),
        approve: (request) => this.requestApproval(state, request),
      });
      const result = await runBuild(opts.doc, ctx);
      job.result = result;
      job.status = "succeeded";
      this.emit(state, {
        type: "done",
        built: result.built,
        reused: result.reused,
        rejected: result.rejected,
      });
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      this.emit(state, { type: "error", message: job.error });
    } finally {
      job.finishedAt = new Date().toISOString();
      this.cleanupApprovals(job.id);
    }
    return job;
  }

  private requestApproval(state: JobState, request: ApprovalRequest): Promise<boolean> {
    const approval: PendingApproval = {
      id: randomUUID(),
      jobId: state.job.id,
      target: request.target,
      output: request.output,
      preview: request.preview,
      step: request.step,
    };
    return new Promise<boolean>((resolve) => {
      const pending: PendingState = { approval, resolve };
      if (this.opts.approvalTimeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          this.pending.delete(approval.id);
          resolve(false); // safe default: deny on timeout
        }, this.opts.approvalTimeoutMs);
      }
      this.pending.set(approval.id, pending);
      this.emit(state, { type: "approval-pending", approval });
    });
  }

  /** Deny any approvals still pending for a finished job (no leaks). */
  private cleanupApprovals(jobId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.approval.jobId !== jobId) continue;
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve(false);
    }
  }
}
