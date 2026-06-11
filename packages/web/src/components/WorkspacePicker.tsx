/** Landing view: pick a workspace to open. */
import { useEffect, useState } from "react";
import type { ApiClient } from "../lib/api.js";
import "./workspace-picker.css";

export interface WorkspacePickerProps {
  readonly api: ApiClient;
  readonly onPick: (workspaceId: string) => void;
}

export function WorkspacePicker({ api, onPick }: WorkspacePickerProps) {
  const [workspaces, setWorkspaces] = useState<string[] | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces, (e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load workspaces"),
    );
  }, [api]);

  return (
    <main className="picker">
      <div className="picker__card">
        <h1 className="picker__title">
          make<span>down</span>
        </h1>
        <p className="picker__tagline">Make for LLM workflows — a collaborative build workspace.</p>

        {error && <p className="picker__error">{error}</p>}
        {!workspaces && !error && <p className="picker__muted">Loading workspaces…</p>}
        {workspaces?.length === 0 && (
          <p className="picker__muted">
            No workspaces found. Create one with a <code>build.md</code> under the server's workspaces root.
          </p>
        )}

        <ul className="picker__list">
          {workspaces?.map((id) => (
            <li key={id}>
              <button className="picker__item" onClick={() => onPick(id)}>
                <span className="picker__item-name">{id}</span>
                <span className="picker__item-arrow" aria-hidden>
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
