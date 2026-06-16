/**
 * Live list of a workspace's source paths, kept in sync with the collaborative
 * doc. Observes the `sources` Y.Map (shallow — key add/remove), so a file that
 * lands via import, auto-import, or a peer's edit appears without polling.
 */
import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { sourcePaths, sourcesMap } from "../lib/doc.js";

export function useSourcePaths(doc: Y.Doc): string[] {
  const [paths, setPaths] = useState<string[]>(() => sourcePaths(doc));

  useEffect(() => {
    const map = sourcesMap(doc);
    const update = (): void => setPaths(sourcePaths(doc));
    update(); // resync if the doc changed between render and effect
    map.observe(update);
    return () => map.unobserve(update);
  }, [doc]);

  return paths;
}
