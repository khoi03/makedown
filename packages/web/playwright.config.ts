import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config: boots the real @makedown/server (against a temp copy of the
 * e2e fixtures) and the Vite dev server pointed at it, then drives a real
 * Chromium browser. This is the only layer that exercises the browser↔server
 * seam (fetch binding, empty-body POST, WS sync, SSE, editor binding) — the
 * class of bug the unit tests can't see.
 */
const SERVER_PORT = 4100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    // Visual-regression tolerances. Baselines are platform-specific; regenerate
    // with `pnpm exec playwright test --update-snapshots` on the canonical host.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/start-server.mjs",
      port: SERVER_PORT,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      env: { E2E_SERVER_PORT: String(SERVER_PORT) },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      env: { MAKEDOWN_SERVER_ORIGIN: `http://localhost:${SERVER_PORT}` },
    },
  ],
});
