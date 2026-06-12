/**
 * @makedown/server — AGPL-3.0 server API.
 *
 * Public surface (Phase 2.2): the workspace service, build orchestration, the
 * Fastify HTTP/SSE API, and the bootstrap that mounts the realtime sync server.
 */
export const SERVER_PACKAGE_VERSION = "0.0.0";

export {
  WorkspaceStore,
  InvalidWorkspaceIdError,
  WorkspaceNotFoundError,
  loadDoc,
  makeServerContext,
  routerConfigFromEnv,
  type ServerContextHooks,
  type ServerContextOptions,
} from "./workspace.js";
export {
  BuildManager,
  type BuildJob,
  type BuildJobStatus,
  type BuildStreamEvent,
  type PendingApproval,
  type StartBuildOptions,
} from "./builds.js";
export {
  getGraph,
  getArtifact,
  getProvenance,
  getCost,
  type GraphView,
  type GraphTargetView,
  type ArtifactView,
} from "./artifacts.js";
export { buildApi, type ApiDeps } from "./api.js";
export { createServer, start, type ServerOptions, type RunningServer } from "./main.js";
