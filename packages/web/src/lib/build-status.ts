/**
 * Fold the build SSE stream into a per-target run status map for badging the
 * DAG. Pure and immutable so React state updates stay predictable.
 */
import type { BuildStreamEvent, TargetRunStatus } from "./types.js";

export type StatusMap = Readonly<Record<string, TargetRunStatus>>;

/** Apply one stream event, returning a new map (never mutates the input). */
export function applyEvent(statuses: StatusMap, event: BuildStreamEvent): StatusMap {
  if (event.type !== "progress") return statuses;
  const e = event.event;
  const next: TargetRunStatus | undefined =
    e.type === "target-start"
      ? "building"
      : e.type === "target-built"
        ? "built"
        : e.type === "target-reused"
          ? "reused"
          : e.type === "target-denied"
            ? "denied"
            : e.type === "target-skipped"
              ? "skipped"
              : undefined;
  if (!next) return statuses;
  return { ...statuses, [e.target]: next };
}

/** Reduce a sequence of stream events into a final status map. */
export function reduceBuildStatuses(events: readonly BuildStreamEvent[]): StatusMap {
  return events.reduce<StatusMap>((acc, event) => applyEvent(acc, event), {});
}
