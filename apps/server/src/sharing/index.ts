/**
 * Sharing public surface. Unlike tenancy, sharing is **not** gated on a
 * database: it works in single-tenant mode (file-backed store) and in team mode
 * (Postgres). Authorization for creating a share is still delegated to the
 * tenancy provider's `share:create` action — permissive under NullTenancy.
 */
export { SharingService } from "./service.js";
export type { CreateShareArgs, CreatedShare } from "./service.js";
export { InMemoryShareStore } from "./memory-store.js";
export { FileShareStore } from "./file-store.js";
export { DrizzleShareStore } from "./drizzle/store.js";
export { shareSchema, SHARE_SCHEMA_SQL } from "./drizzle/schema.js";
export { renderSharePage, renderNotFoundPage } from "./render.js";
export type { ShareStore, CreateShareInput } from "./store.js";
export type { Share, ShareSummary } from "./types.js";
