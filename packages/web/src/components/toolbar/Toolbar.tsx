/** Top bar: identity, connection, branch, snapshot, and the build action. */
import type { ConnectionStatus } from "../../hooks/useCollaborativeDoc.js";
import { AccountMenu } from "../auth/AccountMenu.js";
import "./toolbar.css";

export interface Presence {
  readonly name: string;
  readonly color: string;
}

export interface ToolbarProps {
  readonly workspaceId: string;
  readonly connection: ConnectionStatus;
  readonly branch: string | undefined;
  readonly peers: readonly Presence[];
  readonly building: boolean;
  readonly onBuild: () => void;
  readonly onSnapshot: () => void;
  readonly onSwitchBranch: () => void;
  /** Return to the workspace picker. */
  readonly onBack: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const { workspaceId, connection, branch, peers, building, onBuild, onSnapshot, onSwitchBranch, onBack } =
    props;
  return (
    <header className="toolbar">
      <div className="toolbar__left">
        <button
          className="toolbar__brand"
          onClick={onBack}
          title="Back to workspaces"
          aria-label="Back to workspaces"
        >
          make<span className="toolbar__brand-accent">down</span>
        </button>
        <span className="toolbar__sep" aria-hidden />
        <span className="toolbar__workspace">{workspaceId}</span>
        <button className="toolbar__branch" onClick={onSwitchBranch} title="Switch or create a branch">
          <GitIcon />
          {branch ?? "…"}
        </button>
        <span className="toolbar__conn" data-status={connection} title={`Sync: ${connection}`}>
          <span className="toolbar__conn-dot" />
          {connection}
        </span>
      </div>

      <div className="toolbar__right">
        <PresenceStack peers={peers} />
        <button className="btn btn--ghost" onClick={onSnapshot}>
          Snapshot
        </button>
        <button className="btn btn--primary" onClick={onBuild} disabled={building}>
          {building ? <Spinner /> : <PlayIcon />}
          {building ? "Building…" : "Build"}
        </button>
        <AccountMenu />
      </div>
    </header>
  );
}

function PresenceStack({ peers }: { peers: readonly Presence[] }) {
  if (peers.length === 0) return null;
  return (
    <div className="presence" title={`${peers.length} editing`}>
      {peers.slice(0, 5).map((p, i) => (
        <span
          key={`${p.name}-${i}`}
          className="presence__avatar"
          style={{ background: p.color }}
          title={p.name}
        >
          {p.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?"}
        </span>
      ))}
      {peers.length > 5 && <span className="presence__more">+{peers.length - 5}</span>}
    </div>
  );
}

function GitIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M8.5 6.5h4A3 3 0 0 1 15.5 9.5" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 5l12 7-12 7z" />
    </svg>
  );
}
function Spinner() {
  return <span className="spinner" aria-hidden />;
}
