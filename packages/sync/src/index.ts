/**
 * @makedown/sync — [COMMERCIAL] real-time collaboration layer.
 *
 * Public surface is filled in across Phase 2.1:
 *  - the Yjs workspace document model (doc-model.ts)
 *  - git-backed persistence (persistence.ts)
 *  - the WebSocket sync server (server.ts)
 */
export const SYNC_PACKAGE_VERSION = "0.0.0";

export {
  BUILD_DOC_KEY,
  SOURCES_KEY,
  getBuildText,
  getSourceText,
  listSourcePaths,
  loadSnapshot,
  applySnapshot,
  type WorkspaceSnapshot,
} from "./doc-model.js";
