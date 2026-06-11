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

export {
  readWorkspaceFromDisk,
  materializeToDisk,
  commitSnapshot,
  listSnapshots,
  currentBranch,
  listBranches,
  checkoutBranch,
  assertValidBranchName,
  InvalidBranchNameError,
  saveSnapshot,
  loadIntoDoc,
  switchBranch,
  WorkspacePersistence,
  type Snapshot,
  type GitAuthor,
  type PersistenceOptions,
  type WorkspacePersistenceOptions,
} from "./git-persistence.js";

export { saveDocState, restoreDocState, docStatePath } from "./doc-state.js";

export {
  WorkspaceRoom,
  RoomRegistry,
  encodeSyncStep1,
  encodeSyncUpdate,
  encodeAwarenessMessage,
  readMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  type SyncConnection,
  type RoomRegistryOptions,
} from "./sync-server.js";

export {
  attachWebSocketServer,
  workspaceIdFromPath,
  type WebSocketAdapterOptions,
} from "./ws-adapter.js";
