/**
 * The "Files" sidebar of the workbench: lists `build.md` (pinned) plus every
 * source file in the workspace, and lets the user open one in the editor. It's
 * presentational — the live source list comes from {@link useSourcePaths} in the
 * parent, so a file added by import/auto-import/a peer shows up automatically.
 */
import { BUILD_FILE } from "../../lib/doc.js";
import "./sources.css";

export interface SourcesPanelProps {
  /** Source paths (relative, POSIX), excluding `build.md`. */
  readonly paths: readonly string[];
  /** The file currently open in the editor. */
  readonly activeFile: string;
  readonly onOpen: (path: string) => void;
}

export function SourcesPanel({ paths, activeFile, onOpen }: SourcesPanelProps) {
  return (
    <nav className="sources" aria-label="Workspace files">
      <ul className="sources__list">
        <FileItem path={BUILD_FILE} label={BUILD_FILE} active={activeFile === BUILD_FILE} onOpen={onOpen} />
      </ul>

      <div className="sources__group-label">Sources</div>
      {paths.length === 0 ? (
        <p className="sources__empty">No sources yet — import a file to add one.</p>
      ) : (
        <ul className="sources__list">
          {paths.map((path) => (
            <FileItem key={path} path={path} label={path} active={activeFile === path} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </nav>
  );
}

interface FileItemProps {
  readonly path: string;
  readonly label: string;
  readonly active: boolean;
  readonly onOpen: (path: string) => void;
}

function FileItem({ path, label, active, onOpen }: FileItemProps) {
  return (
    <li>
      <button
        type="button"
        className={`sources__item${active ? " sources__item--active" : ""}`}
        aria-current={active ? "true" : undefined}
        title={path}
        onClick={() => onOpen(path)}
      >
        <span className="sources__name mono">{label}</span>
      </button>
    </li>
  );
}
