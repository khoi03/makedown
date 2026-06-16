/**
 * Tracks which workspace file is open in the editor and the rules for switching:
 *
 *  - `openFile`    — open a file that exists right now (build.md or a present
 *                    source); used by the Files sidebar.
 *  - `requestOpen` — open a path *once it appears* in the workspace. Imported /
 *                    auto-imported sources arrive asynchronously over sync, so we
 *                    wait for the path rather than binding the editor to (and
 *                    locally creating) a Y.Text the server hasn't delivered yet.
 *
 * If the open source later disappears (deletion, branch switch, snapshot reload)
 * the active file falls back to build.md instead of a phantom empty document.
 */
import { useCallback, useEffect, useState } from "react";
import { BUILD_FILE } from "../lib/doc.js";

export interface ActiveFile {
  readonly activeFile: string;
  readonly openFile: (path: string) => void;
  readonly requestOpen: (path: string) => void;
}

export function useActiveFile(sourcePaths: readonly string[]): ActiveFile {
  const [activeFile, setActiveFile] = useState<string>(BUILD_FILE);
  const [pendingOpen, setPendingOpen] = useState<string>();

  // A requested file becomes active the moment it lands in the workspace.
  useEffect(() => {
    if (pendingOpen && sourcePaths.includes(pendingOpen)) {
      setActiveFile(pendingOpen);
      setPendingOpen(undefined);
    }
  }, [pendingOpen, sourcePaths]);

  // The open source vanished — return to the always-present build spec.
  useEffect(() => {
    if (activeFile !== BUILD_FILE && !sourcePaths.includes(activeFile)) {
      setActiveFile(BUILD_FILE);
    }
  }, [activeFile, sourcePaths]);

  // An explicit open cancels any pending auto-open, so a slow import can't later
  // yank the editor away from a file the user deliberately navigated to.
  const openFile = useCallback((path: string): void => {
    setPendingOpen(undefined);
    setActiveFile(path);
  }, []);

  return { activeFile, openFile, requestOpen: setPendingOpen };
}
