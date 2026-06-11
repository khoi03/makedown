/**
 * The artifact inspector: for the selected target, shows the compiled artifact,
 * its provenance (`md why`), or the workspace cost estimate. Data is fetched
 * lazily per selection/tab and refreshed when the build generation changes.
 */
import { useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api.js";
import type { ArtifactView, BuildCost, Provenance } from "../../lib/types.js";
import { formatUsd, shortHash, formatDuration, formatTokens } from "../../lib/format.js";
import "./inspector.css";

type Tab = "artifact" | "why" | "cost";

export interface InspectorPaneProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly target: string | undefined;
  /** Bump to force a refetch (e.g. after a build completes). */
  readonly generation: number;
}

export function InspectorPane({ api, workspaceId, target, generation }: InspectorPaneProps) {
  const [tab, setTab] = useState<Tab>("artifact");

  return (
    <div className="inspector">
      <div className="inspector__tabs" role="tablist">
        {(["artifact", "why", "cost"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className="inspector__tab"
            data-active={tab === t ? "" : undefined}
            onClick={() => setTab(t)}
          >
            {t === "why" ? "Provenance" : t === "cost" ? "Cost" : "Artifact"}
          </button>
        ))}
      </div>
      <div className="inspector__body">
        {tab === "cost" ? (
          <CostView api={api} workspaceId={workspaceId} generation={generation} />
        ) : !target ? (
          <Empty>Select a target in the graph to inspect it.</Empty>
        ) : tab === "artifact" ? (
          <ArtifactTab api={api} workspaceId={workspaceId} target={target} generation={generation} />
        ) : (
          <WhyTab api={api} workspaceId={workspaceId} target={target} generation={generation} />
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="inspector__empty">{children}</div>;
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data?: T; error?: string; loading: boolean } {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (err: unknown) => live && setState({ error: err instanceof Error ? err.message : String(err), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function ArtifactTab(props: { api: ApiClient; workspaceId: string; target: string; generation: number }) {
  const { api, workspaceId, target, generation } = props;
  const { data, loading } = useAsync<ArtifactView | undefined>(
    () => api.getArtifact(workspaceId, target),
    [workspaceId, target, generation],
  );
  if (loading) return <Empty>Loading…</Empty>;
  if (!data) return <Empty>Not built yet. Run a build to produce this artifact.</Empty>;
  return <pre className="inspector__artifact mono">{data.content}</pre>;
}

function WhyTab(props: { api: ApiClient; workspaceId: string; target: string; generation: number }) {
  const { api, workspaceId, target, generation } = props;
  const { data, loading } = useAsync<Provenance | undefined>(
    () => api.getProvenance(workspaceId, target),
    [workspaceId, target, generation],
  );
  if (loading) return <Empty>Loading…</Empty>;
  if (!data) return <Empty>No provenance yet — this target has not been built.</Empty>;
  return (
    <dl className="provenance">
      <Row k="Target" v={data.target} />
      <Row k="Step" v={data.step} />
      {data.model && <Row k="Model" v={data.model} />}
      <Row k="Identity" v={shortHash(data.id)} mono />
      <Row k="Tokens" v={formatTokens(data.tokens)} />
      <Row k="Cost" v={data.costUsd !== undefined ? formatUsd(data.costUsd) : "—"} />
      <Row k="Duration" v={formatDuration(data.durationMs)} />
      <Row k="Produced" v={new Date(data.producedAt).toLocaleString()} />
      <div className="provenance__inputs">
        <span className="provenance__k">Inputs</span>
        <ul>
          {data.inputs.map((i) => (
            <li key={i.ref} className="mono">
              <span data-kind={i.kind}>{i.kind}</span> {i.ref} · {shortHash(i.hash)}
            </li>
          ))}
        </ul>
      </div>
    </dl>
  );
}

function CostView(props: { api: ApiClient; workspaceId: string; generation: number }) {
  const { api, workspaceId, generation } = props;
  const { data, loading } = useAsync<BuildCost>(() => api.getCost(workspaceId), [workspaceId, generation]);
  if (loading) return <Empty>Estimating…</Empty>;
  if (!data) return <Empty>No cost estimate.</Empty>;
  return (
    <div className="cost">
      <div className="cost__total">
        <span>Estimated next build</span>
        <strong>
          {formatUsd(data.totalCostUsd)}
          {data.hasUnpriced ? " +" : ""}
        </strong>
      </div>
      <table className="cost__table">
        <thead>
          <tr>
            <th>Target</th>
            <th>Calls</th>
            <th>Max out</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.targets.map((t) => (
            <tr key={t.target} data-stale={t.stale ? "" : undefined}>
              <td>{t.target}</td>
              <td className="mono">{t.calls}</td>
              <td className="mono">{t.maxOutputTokens.toLocaleString()}</td>
              <td className="mono">{t.costUsd !== undefined ? formatUsd(t.costUsd) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="provenance__row">
      <span className="provenance__k">{k}</span>
      <span className={mono ? "mono" : undefined}>{v}</span>
    </div>
  );
}
