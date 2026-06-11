/**
 * Collaborative `build.md` editor: CodeMirror 6 bound to the shared Y.Text via
 * y-codemirror.next, with remote cursors driven by the provider's awareness.
 * The editor never holds its own source of truth — the Y.Text is authoritative.
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
  readonly doc: Y.Doc;
  readonly awareness: Awareness | null;
}

export function EditorPane({ doc, awareness }: EditorPaneProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current || !awareness) return;
    const ytext = doc.getText("build.md");
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [basicSetup, markdown(), workbenchTheme, yCollab(ytext, awareness)],
      }),
    });
    return () => view.destroy();
  }, [doc, awareness]);

  return <div className="editor" ref={host} data-testid="editor" />;
}
