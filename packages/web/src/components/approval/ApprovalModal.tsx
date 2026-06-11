/**
 * Human-in-the-loop approval gate. When a build produces a side-effectful
 * `agent` artifact requiring approval, this modal shows the produced diff and
 * lets the reviewer approve or reject before it is accepted downstream.
 */
import type { PendingApproval } from "../../lib/types.js";
import "./approval.css";

export interface ApprovalModalProps {
  readonly approval: PendingApproval;
  readonly onResolve: (approved: boolean) => void;
}

export function ApprovalModal({ approval, onResolve }: ApprovalModalProps) {
  return (
    <div className="approval-overlay" role="dialog" aria-modal aria-labelledby="approval-title">
      <div className="approval">
        <header className="approval__head">
          <h2 id="approval-title">Approval required</h2>
          <p>
            Target <strong>{approval.target}</strong> ({approval.step}) produced output for{" "}
            <code>{approval.output}</code>. Review before it is accepted.
          </p>
        </header>
        <pre className="approval__preview mono">{approval.preview || "(no diff produced)"}</pre>
        <footer className="approval__actions">
          <button className="btn btn--ghost" onClick={() => onResolve(false)}>
            Reject
          </button>
          <button className="btn btn--primary" onClick={() => onResolve(true)}>
            Approve
          </button>
        </footer>
      </div>
    </div>
  );
}
