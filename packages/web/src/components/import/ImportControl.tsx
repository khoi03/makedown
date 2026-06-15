/**
 * "Import file" control: the web counterpart to `md import`. Picks a local
 * non-Markdown file, uploads it (base64) to the server's import endpoint, and on
 * success shows the `{{sources/…}}` reference to paste into build.md. The
 * converted source also lands in the live doc + on disk server-side, so a build
 * can use it immediately. Errors surface inline rather than failing silently.
 */
import { useRef, useState } from "react";
import type { ApiClient } from "../../lib/api.js";
import "./import.css";

export interface ImportControlProps {
  readonly api: ApiClient;
  readonly workspaceId: string;
}

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly name: string }
  | { readonly kind: "done"; readonly path: string; readonly cached: boolean }
  | { readonly kind: "error"; readonly message: string };

export function ImportControl({ api, workspaceId }: ImportControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file
    if (!file) return;

    setState({ kind: "busy", name: file.name });
    try {
      const base64 = await fileToBase64(file);
      const result = await api.importSource(workspaceId, file.name, base64);
      setState({ kind: "done", path: result.path, cached: result.cached });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Import failed" });
    }
  }

  const busy = state.kind === "busy";

  return (
    <div className="import">
      <button
        type="button"
        className="import__btn"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="Convert a PDF, DOCX, PPTX, XLSX, HTML, … file to a Markdown source"
      >
        {busy ? `Importing ${state.name}…` : "Import file"}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="import__input"
        onChange={onFile}
        data-testid="import-input"
        aria-hidden="true"
        tabIndex={-1}
      />
      {state.kind === "done" && (
        <span className="import__msg import__msg--ok" role="status">
          {state.cached ? "From cache —" : "Imported —"} reference as <code>{`{{${state.path}}}`}</code>
        </span>
      )}
      {state.kind === "error" && (
        <span className="import__msg import__msg--err" role="alert">
          {state.message}
        </span>
      )}
    </div>
  );
}

/** Read a File as base64 (without the `data:…;base64,` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
