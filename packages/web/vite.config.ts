import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app talks to @makedown/server. In dev we proxy the API + WS so the
// browser only ever sees one origin (no CORS, cookies just work).
const SERVER_ORIGIN = process.env["MAKEDOWN_SERVER_ORIGIN"] ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: SERVER_ORIGIN, changeOrigin: true },
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
  },
});
