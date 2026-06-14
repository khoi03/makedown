/**
 * Share panel for the artifact inspector: mints a public, read-only link to the
 * selected built artifact, and lists/revokes existing links. The bearer token is
 * shown exactly once (at creation), mirroring the server's store-only-the-hash
 * model — so the freshly minted link gets a prominent copy affordance, while the
 * list below only offers revoke.
 */
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api.js";
import type { ShareSummary } from "../../lib/types.js";

export interface SharePanelProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly target: string;
}

interface MintedLink {
  readonly id: string;
  readonly url: string;
}

/** Absolute URL for a server-relative share path, using the app's own origin. */
function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

export function SharePanel({ api, workspaceId, target }: SharePanelProps) {
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [includeProvenance, setIncludeProvenance] = useState(false);
  const [minted, setMinted] = useState<MintedLink | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setShares(await api.listShares(workspaceId));
    } catch {
      // Listing is best-effort — a transient failure shouldn't block creating.
      setShares([]);
    }
  }, [api, workspaceId]);

  useEffect(() => {
    setMinted(undefined);
    setError(undefined);
    void refresh();
  }, [refresh, target]);

  async function create(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      const created = await api.createShare(workspaceId, target, { includeProvenance });
      setMinted({ id: created.id, url: absoluteUrl(created.path) });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a share link");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setError(undefined);
    try {
      await api.revokeShare(id);
      if (minted?.id === id) setMinted(undefined);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke");
    }
  }

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const live = shares.filter((s) => !s.revoked);

  return (
    <section className="share" aria-label="Share">
      <div className="share__head">
        <h3 className="share__title">Share</h3>
        <label className="share__opt">
          <input
            type="checkbox"
            checked={includeProvenance}
            onChange={(e) => setIncludeProvenance(e.target.checked)}
          />
          Include provenance
        </label>
      </div>
      <p className="share__hint">Anyone with the link can view this artifact — read-only, no sign-in.</p>

      <button className="share__create" onClick={() => void create()} disabled={busy}>
        {busy ? "Creating…" : "Create link"}
      </button>

      {error && <p className="share__error">{error}</p>}

      {minted && (
        <div className="share__minted">
          <span className="share__minted-label">Copy this link now — it won't be shown again.</span>
          <div className="share__link-row">
            <input className="share__link mono" readOnly value={minted.url} aria-label="Share link" />
            <button className="share__copy" onClick={() => void copy(minted.url)}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {live.length > 0 && (
        <ul className="share__list">
          {live.map((s) => (
            <li key={s.id} className="share__item">
              <span className="share__item-meta mono">
                {new Date(s.createdAt).toLocaleDateString()}
                {s.includeProvenance ? " · prov" : ""}
                {s.expiresAt ? " · expires" : ""}
              </span>
              <button className="share__revoke" onClick={() => void revoke(s.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
