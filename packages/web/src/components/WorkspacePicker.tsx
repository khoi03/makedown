/** Landing view: pick a workspace to open (and, in team mode, claim on-disk ones). */
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Org } from "../lib/api.js";
import { AccountMenu } from "./auth/AccountMenu.js";
import "./workspace-picker.css";

export interface WorkspacePickerProps {
  readonly api: ApiClient;
  readonly onPick: (workspaceId: string) => void;
}

export function WorkspacePicker({ api, onPick }: WorkspacePickerProps) {
  const [workspaces, setWorkspaces] = useState<string[] | undefined>();
  const [available, setAvailable] = useState<string[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setWorkspaces(await api.listWorkspaces());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspaces");
      return;
    }
    // Team-mode extras — best-effort, so a single-tenant or older server simply
    // shows no "add" affordance (both calls return empty there).
    try {
      const [avail, orgList] = await Promise.all([api.listAvailableWorkspaces(), api.listOrgs()]);
      setAvailable(avail);
      setOrgs(orgList);
    } catch {
      setAvailable([]);
      setOrgs([]);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const targetOrg = orgs[0];

  async function claim(id: string): Promise<void> {
    if (!targetOrg) return;
    setAdding(id);
    setError(undefined);
    try {
      await api.registerWorkspace(targetOrg.id, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add workspace");
    } finally {
      setAdding(undefined);
    }
  }

  const canClaim = Boolean(targetOrg) && available.length > 0;

  return (
    <main className="picker">
      <div className="picker__account">
        <AccountMenu />
      </div>
      <div className="picker__card">
        <h1 className="picker__title">
          make<span>down</span>
        </h1>
        <p className="picker__tagline">Make for LLM workflows — a collaborative build workspace.</p>

        {error && <p className="picker__error">{error}</p>}
        {!workspaces && !error && <p className="picker__muted">Loading workspaces…</p>}
        {workspaces?.length === 0 && !canClaim && (
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

        {canClaim && (
          <section className="picker__add">
            <h2 className="picker__add-title">
              Add to <span>{targetOrg!.name}</span>
            </h2>
            <p className="picker__muted">Unclaimed workspaces on this server you can bring into your team:</p>
            <ul className="picker__list">
              {available.map((id) => (
                <li key={id}>
                  <button
                    className="picker__add-item"
                    onClick={() => void claim(id)}
                    disabled={adding === id}
                  >
                    <span className="picker__item-name">{id}</span>
                    <span className="picker__add-action">{adding === id ? "Adding…" : "+ Add"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
