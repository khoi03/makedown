/**
 * Cost analytics dashboard: an org-scoped, read-only view over the provenance
 * index (spend / tokens / runs by workspace, model, target, and day).
 *
 * Resolves the caller's org(s) once, then fetches aggregates for the selected
 * time window. Three terminal states, all graceful:
 *  - the server has no index (single-tenant) → a "team mode" explainer;
 *  - the org has no builds in range → an empty state;
 *  - otherwise → headline totals, a daily spend series, and ranked breakdowns.
 *
 * Charts are hand-rolled SVG/CSS (no charting dependency) to stay within the
 * bundle budget and reuse the build-workbench design tokens.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiClient, Org } from "../../lib/api.js";
import type { AnalyticsBucket, AnalyticsSummary } from "../../lib/types.js";
import { formatUsd, formatTokens } from "../../lib/format.js";
import {
  RANGE_PRESETS,
  DEFAULT_RANGE_DAYS,
  rangeFromPreset,
  withBarFractions,
  formatCount,
} from "../../lib/analytics.js";
import { AccountMenu } from "../auth/AccountMenu.js";
import { DailySpendChart } from "./DailySpendChart.js";
import "./dashboard.css";

export interface DashboardProps {
  readonly api: ApiClient;
  /** Navigate back to the workspace picker. */
  readonly onBack?: () => void;
}

type Load =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "disabled" }
  | { readonly status: "ready"; readonly summary: AnalyticsSummary };

export function Dashboard({ api, onBack }: DashboardProps) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<string>();
  // Gate fetching until orgs resolve, so we issue exactly one request with the
  // right org id (no wasted initial fetch, no loading flash on re-render).
  const [orgsResolved, setOrgsResolved] = useState(false);
  const [days, setDays] = useState<number | null>(DEFAULT_RANGE_DAYS);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  // Resolve the caller's orgs once; default to the first (single-tenant → none).
  useEffect(() => {
    let live = true;
    api.listOrgs().then(
      (list) => {
        if (!live) return;
        setOrgs(list);
        setOrgId(list[0]?.id);
        setOrgsResolved(true);
      },
      () => {
        if (!live) return;
        setOrgs([]);
        setOrgsResolved(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const fetchAnalytics = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      // A placeholder id is harmless when tenancy is disabled (the server
      // returns `{ enabled: false }` without touching it).
      const res = await api.getAnalytics(orgId ?? "_", rangeFromPreset(days));
      if (!res.enabled || !res.summary) {
        setLoad({ status: "disabled" });
        return;
      }
      setLoad({ status: "ready", summary: res.summary });
    } catch (err) {
      setLoad({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [api, orgId, days]);

  useEffect(() => {
    if (orgsResolved) void fetchAnalytics();
  }, [orgsResolved, fetchAnalytics]);

  return (
    <main className="dash">
      <header className="dash__top">
        <div className="dash__top-left">
          {onBack && (
            <button type="button" className="dash__back" onClick={onBack}>
              ← Workspaces
            </button>
          )}
          <h1 className="dash__title">Cost analytics</h1>
        </div>
        <div className="dash__top-right">
          {orgs.length > 1 && (
            <select
              className="dash__select"
              aria-label="Organization"
              value={orgId ?? ""}
              onChange={(e) => setOrgId(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <div className="dash__ranges" role="group" aria-label="Time range">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="dash__range"
                data-active={p.days === days ? "" : undefined}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <AccountMenu />
        </div>
      </header>

      <div className="dash__body">
        {load.status === "loading" && <p className="dash__muted">Loading analytics…</p>}
        {load.status === "error" && <p className="dash__error">{load.message}</p>}
        {load.status === "disabled" && <SingleTenantNotice />}
        {load.status === "ready" && <Report summary={load.summary} />}
      </div>
    </main>
  );
}

function SingleTenantNotice() {
  return (
    <div className="dash__notice">
      <h2>Cost analytics requires team mode</h2>
      <p>
        This server is running single-tenant, so there is no provenance index to aggregate. Set{" "}
        <code>DATABASE_URL</code> to enable teams, auth, and the cross-workspace cost index, then
        rebuild your workspaces to populate it.
      </p>
    </div>
  );
}

function Report({ summary }: { summary: AnalyticsSummary }) {
  const { totals } = summary;
  if (totals.runs === 0) {
    return (
      <div className="dash__notice">
        <h2>No builds recorded yet</h2>
        <p>Run a build in this time range to start tracking spend, tokens, and usage here.</p>
      </div>
    );
  }
  return (
    <>
      <section className="dash__cards">
        <Card label="Total spend" value={formatUsd(totals.costUsd)} hint="distinct artifact production" />
        <Card label="Artifacts produced" value={formatCount(totals.runs)} hint="cache-hit rebuilds excluded" />
        <Card label="Input tokens" value={formatCount(totals.tokensInput)} />
        <Card label="Output tokens" value={formatCount(totals.tokensOutput)} />
      </section>

      <section className="dash__panel">
        <h2 className="dash__panel-title">Spend over time</h2>
        <DailySpendChart days={summary.byDay} />
      </section>

      <div className="dash__grid">
        <Breakdown title="By workspace" buckets={summary.byWorkspace} />
        <Breakdown title="By model" buckets={summary.byModel} />
        <Breakdown title="By target" buckets={summary.byTarget} />
      </div>
    </>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="dash__card">
      <span className="dash__card-label">{label}</span>
      <strong className="dash__card-value mono">{value}</strong>
      {hint && <span className="dash__card-hint">{hint}</span>}
    </div>
  );
}

function Breakdown({ title, buckets }: { title: string; buckets: readonly AnalyticsBucket[] }) {
  const scaled = useMemo(() => withBarFractions(buckets), [buckets]);
  return (
    <section className="dash__panel">
      <h2 className="dash__panel-title">{title}</h2>
      {scaled.length === 0 ? (
        <p className="dash__muted">No data.</p>
      ) : (
        <ul className="dash__bars">
          {scaled.map((b) => (
            <li key={b.key} className="dash__bar-row">
              <span className="dash__bar-key" title={b.key}>
                {b.key}
              </span>
              <span className="dash__bar-track">
                <span className="dash__bar-fill" style={{ width: `${(b.fraction * 100).toFixed(1)}%` }} />
              </span>
              <span className="dash__bar-cost mono">{formatUsd(b.costUsd)}</span>
              <span className="dash__bar-runs mono" title={formatTokens({ input: b.tokensInput, output: b.tokensOutput })}>
                {formatCount(b.runs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
