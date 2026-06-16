/**
 * Workspace orchestrator: wires the collaborative doc, the live graph, the build
 * stream, presence, and snapshots/branches into the three-pane workbench.
 *
 * The graph refreshes on a debounce as build.md changes (the server flushes the
 * live doc to disk when serving the graph), and again when a build completes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../lib/api.js";
import type { GraphView } from "../lib/types.js";
import { useCollaborativeDoc, type LocalUser } from "../hooks/useCollaborativeDoc.js";
import { useBuildStream } from "../hooks/useBuildStream.js";
import { useSourcePaths } from "../hooks/useSourcePaths.js";
import { useActiveFile } from "../hooks/useActiveFile.js";
import { fileText } from "../lib/doc.js";
import { Toolbar, type Presence } from "./toolbar/Toolbar.js";
import { EditorPane } from "./editor/EditorPane.js";
import { SourcesPanel } from "./sources/SourcesPanel.js";
import { ImportControl } from "./import/ImportControl.js";
import { GraphPane } from "./graph/GraphPane.js";
import { InspectorPane } from "./inspector/InspectorPane.js";
import { ApprovalModal } from "./approval/ApprovalModal.js";

const GRAPH_DEBOUNCE_MS = 700;

export interface WorkbenchProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
  readonly user: LocalUser;
  /** Return to the workspace picker. */
  readonly onBack: () => void;
}

export function Workbench({ api, workspaceId, user, onBack }: WorkbenchProps) {
  const { doc, provider, status } = useCollaborativeDoc(workspaceId, api.syncBaseUrl(), user);
  const [graph, setGraph] = useState<GraphView>();
  const [selected, setSelected] = useState<string>();
  const [branch, setBranch] = useState<string>();
  const [peers, setPeers] = useState<Presence[]>([]);
  const [jobId, setJobId] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const sourcePaths = useSourcePaths(doc);
  const { activeFile, openFile, requestOpen } = useActiveFile(sourcePaths);
  const activeText = useMemo(() => fileText(doc, activeFile), [doc, activeFile]);

  const eventsUrl = jobId ? api.buildEventsUrl(jobId) : undefined;
  const stream = useBuildStream(jobId, eventsUrl);

  const refreshGraph = useCallback(async () => {
    try {
      setGraph(await api.getGraph(workspaceId));
    } catch {
      // a transient/invalid build.md shouldn't blow away the last good graph
    }
  }, [api, workspaceId]);

  // Initial load: graph + branch.
  useEffect(() => {
    void refreshGraph();
    api.getBranches(workspaceId).then(
      (b) => setBranch(b.current),
      () => setBranch(undefined),
    );
  }, [api, workspaceId, refreshGraph]);

  // Debounced graph refresh as the spec is edited.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    const ytext = doc.getText("build.md");
    const onChange = (): void => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refreshGraph(), GRAPH_DEBOUNCE_MS);
    };
    ytext.observe(onChange);
    return () => {
      ytext.unobserve(onChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [doc, refreshGraph]);

  // Refresh once a build finishes.
  useEffect(() => {
    if (stream.result) {
      void refreshGraph();
      setGeneration((g) => g + 1);
    }
  }, [stream.result, refreshGraph]);

  // Track collaborators' presence.
  useEffect(() => {
    if (!provider) return;
    const awareness = provider.awareness;
    const update = (): void => {
      const others: Presence[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const u = (state as { user?: Presence }).user;
        if (u) others.push(u);
      }
      setPeers(others);
    };
    awareness.on("change", update);
    update();
    return () => awareness.off("change", update);
  }, [provider]);

  const onBuild = useCallback(async () => {
    setJobId(await api.startBuild(workspaceId));
  }, [api, workspaceId]);

  const onSnapshot = useCallback(async () => {
    const message = window.prompt("Snapshot message:");
    if (!message) return;
    try {
      await api.createSnapshot(workspaceId, message);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Snapshot failed");
    }
  }, [api, workspaceId]);

  const onSwitchBranch = useCallback(async () => {
    const name = window.prompt("Branch name (created if new):");
    if (!name) return;
    try {
      const branches = await api.getBranches(workspaceId);
      const create = !branches.branches.includes(name);
      const { current } = await api.switchBranch(workspaceId, name, create);
      setBranch(current);
      await refreshGraph();
      setGeneration((g) => g + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Branch switch failed");
    }
  }, [api, workspaceId, refreshGraph]);

  const pending = stream.pending[0];
  const onResolve = useCallback(
    async (approved: boolean) => {
      if (!pending || !jobId) return;
      stream.clearApproval(pending.id);
      try {
        await api.resolveApproval(jobId, pending.id, approved);
      } catch {
        // already resolved or job ended — safe to ignore
      }
    },
    [api, jobId, pending, stream],
  );

  const awareness = useMemo(() => provider?.awareness ?? null, [provider]);

  return (
    <div className="workbench">
      <Toolbar
        workspaceId={workspaceId}
        connection={status}
        branch={branch}
        peers={peers}
        building={stream.running}
        onBuild={onBuild}
        onSnapshot={onSnapshot}
        onSwitchBranch={onSwitchBranch}
        onBack={onBack}
      />
      <div className="workbench__panes">
        <section className="pane">
          <div className="pane__header">
            <span className="pane__title">Files</span>
            <ImportControl api={api} workspaceId={workspaceId} onImported={requestOpen} />
          </div>
          <div className="pane__body files">
            <SourcesPanel paths={sourcePaths} activeFile={activeFile} onOpen={openFile} />
            <div className="files__editor">
              <div className="files__active mono" data-testid="active-file">
                {activeFile}
              </div>
              <EditorPane text={activeText} awareness={awareness} />
            </div>
          </div>
        </section>

        <section className="pane">
          <div className="pane__header">
            <span className="pane__title">Build graph</span>
            {stream.error && <span className="pane__error">{stream.error}</span>}
          </div>
          <div className="pane__body">
            <GraphPane graph={graph} statuses={stream.statuses} selected={selected} onSelect={setSelected} />
          </div>
        </section>

        <section className="pane">
          <div className="pane__header">
            <span className="pane__title">Inspector</span>
            {selected && <span className="pane__subject mono">{selected}</span>}
          </div>
          <div className="pane__body">
            <InspectorPane api={api} workspaceId={workspaceId} target={selected} generation={generation} />
          </div>
        </section>
      </div>

      {pending && <ApprovalModal approval={pending} onResolve={onResolve} />}
    </div>
  );
}
