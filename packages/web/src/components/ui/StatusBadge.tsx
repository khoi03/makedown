import type { TargetRunStatus } from "../../lib/types.js";
import "./status-badge.css";

export interface StatusBadgeProps {
  /** Live run status from the build stream, if any. */
  readonly status?: TargetRunStatus;
  /** Whether the target is stale (used when there is no live run status). */
  readonly stale: boolean;
}

type Display = { readonly key: string; readonly label: string };

/** Resolve the badge to show: live status wins, else the stale/fresh baseline. */
export function resolveBadge(status: TargetRunStatus | undefined, stale: boolean): Display {
  switch (status) {
    case "building":
      return { key: "building", label: "Building" };
    case "built":
      return { key: "built", label: "Built" };
    case "reused":
      return { key: "reused", label: "Reused" };
    case "denied":
      return { key: "denied", label: "Denied" };
    case "skipped":
      return { key: "skipped", label: "Skipped" };
    default:
      return stale ? { key: "stale", label: "Stale" } : { key: "fresh", label: "Fresh" };
  }
}

export function StatusBadge({ status, stale }: StatusBadgeProps) {
  const { key, label } = resolveBadge(status, stale);
  return (
    <span className="status-badge" data-status={key}>
      <span className="status-badge__dot" aria-hidden />
      {label}
    </span>
  );
}
