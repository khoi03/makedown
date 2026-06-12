import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app talks to @makedown/server. In dev the HTTP API is proxied so the
// browser sees one origin (no CORS). The collaboration WebSocket, however, is
// connected DIRECTLY to the server: Vite's ws proxy is unreliable and logs
// `write ECONNABORTED` on every y-websocket reconnect. In production the web is
// served same-origin as the server, so no override is needed.
const SERVER_ORIGIN = process.env["MAKEDOWN_SERVER_ORIGIN"] ?? "http://localhost:4000";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Injected into the client: the origin for the collab WebSocket. Only set in
  // dev (empty in test/prod → fall back to same-origin window.location).
  define: {
    __SYNC_ORIGIN__: JSON.stringify(mode === "development" ? SERVER_ORIGIN : ""),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: SERVER_ORIGIN, changeOrigin: true },
      // Kept as a fallback for clients that still hit the proxy path.
      "/sync": { target: SERVER_ORIGIN, ws: true, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy editor/graph/CRDT vendors so they cache independently
        // and stay off the landing route's critical path.
        manualChunks: {
          react: ["react", "react-dom"],
          codemirror: ["codemirror", "@codemirror/state", "@codemirror/view", "@codemirror/lang-markdown"],
          flow: ["@xyflow/react"],
          yjs: ["yjs", "y-websocket", "y-codemirror.next"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Playwright specs live under e2e/ and must not be collected by vitest.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
}));
