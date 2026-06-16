/**
 * Collaborative Markdown editor: CodeMirror 6 bound to a shared Y.Text via
 * y-codemirror.next, with remote cursors driven by the provider's awareness.
 * The editor never holds its own source of truth — the Y.Text is authoritative.
 * Works for any workspace file (`build.md` or a source); the parent decides
 * which Y.Text to bind. Switching `text` tears down and rebinds the view.
 */
import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab } from "y-codemirror.next";
import { workbenchTheme } from "./editor-theme.js";
import "./editor.css";

export interface EditorPaneProps {
  /** The live Y.Text to edit (e.g. `doc.getText("build.md")` or a source text). */
  readonly text: Y.Text;
  readonly awareness: Awareness | null;
}

export function EditorPane({ text, awareness }: EditorPaneProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current || !awareness) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [basicSetup, markdown(), workbenchTheme, yCollab(text, awareness)],
      }),
    });
    return () => view.destroy();
  }, [text, awareness]);

  return <div className="editor" ref={host} data-testid="editor" />;
}
