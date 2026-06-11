import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// Note: intentionally NOT wrapped in <StrictMode>. StrictMode double-invokes
// effects in dev, which double-binds the collaborative CodeMirror editor to the
// shared Y.Text and can duplicate document content. The editor binding is a
// real side effect on shared CRDT state, so a single, stable mount is required.
createRoot(root).render(<App />);
