/**
 * Subscribes to a build's SSE stream and exposes derived state: per-target run
 * statuses (for DAG badges), the queue of pending approvals, and a terminal
 * result. Closing the stream / changing the job tears the EventSource down.
 */
import { useEffect, useState } from "react";
import { applyEvent, type StatusMap } from "../lib/build-status.js";
import type { BuildStreamEvent, PendingApproval } from "../lib/types.js";

export interface BuildResultSummary {
  readonly built: readonly string[];
  readonly reused: readonly string[];
  readonly rejected: readonly string[];
}

export interface BuildStreamState {
  readonly running: boolean;
  readonly statuses: StatusMap;
  readonly pending: readonly PendingApproval[];
  readonly result: BuildResultSummary | undefined;
  readonly error: string | undefined;
  /** Drop a pending approval locally once it has been resolved over HTTP. */
  clearApproval(id: string): void;
}

export function useBuildStream(jobId: string | undefined, eventsUrl: string | undefined): BuildStreamState {
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [pending, setPending] = useState<readonly PendingApproval[]>([]);
  const [result, setResult] = useState<BuildResultSummary | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!jobId || !eventsUrl) return;
    setStatuses({});
    setPending([]);
    setResult(undefined);
    setError(undefined);
    setRunning(true);

    const source = new EventSource(eventsUrl);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as BuildStreamEvent;
      setStatuses((prev) => applyEvent(prev, event));
      if (event.type === "approval-pending") {
        setPending((prev) => [...prev, event.approval]);
      } else if (event.type === "progress") {
        // A resolved target clears any of its lingering approvals.
        const t = event.event.target;
        if (event.event.type === "target-built" || event.event.type === "target-denied") {
          setPending((prev) => prev.filter((a) => a.target !== t));
        }
      } else if (event.type === "done") {
        setResult({ built: event.built, reused: event.reused, rejected: event.rejected });
        setRunning(false);
        source.close();
      } else if (event.type === "error") {
        setError(event.message);
        setRunning(false);
        source.close();
      }
    };
    source.onerror = () => {
      setRunning(false);
      source.close();
    };
    return () => source.close();
  }, [jobId, eventsUrl]);

  return {
    running,
    statuses,
    pending,
    result,
    error,
    clearApproval: (id) => setPending((prev) => prev.filter((a) => a.id !== id)),
  };
}
