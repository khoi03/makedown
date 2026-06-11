/** CodeMirror theme matching the workbench design tokens. */
import { EditorView } from "@codemirror/view";

export const workbenchTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "13px",
      color: "var(--text)",
      backgroundColor: "var(--surface-base)",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      caretColor: "var(--accent)",
      padding: "var(--space-4) 0",
    },
    ".cm-scroller": { overflow: "auto", lineHeight: "1.6" },
    ".cm-gutters": {
      backgroundColor: "var(--surface-sunken)",
      color: "var(--text-faint)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "oklch(25% 0.016 274 / 0.4)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-muted)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft)" },
  },
  { dark: true },
);
