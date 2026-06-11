/// <reference types="vite/client" />

/**
 * Origin of the @makedown/server for the collaboration WebSocket, injected by
 * `vite.config.ts` `define`. Non-empty only in dev (connect directly, bypassing
 * the flaky Vite ws proxy); empty in test/prod (fall back to same-origin).
 */
declare const __SYNC_ORIGIN__: string;
