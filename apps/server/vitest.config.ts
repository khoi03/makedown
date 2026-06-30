import { defineConfig } from "vitest/config";

/**
 * The Drizzle integration tests boot Postgres-in-WASM (pglite) in a per-test
 * setup hook. Its first cold start (WASM compile + schema DDL) can exceed
 * vitest's default 10s hookTimeout on a constrained CI runner — the test bodies
 * themselves are fast, but the setup hook is what trips. Raise the hook and test
 * timeouts so these integration tests are resilient to slow environments.
 */
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
