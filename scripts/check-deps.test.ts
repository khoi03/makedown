import { describe, it, expect } from "vitest";
import { findForbiddenImports, SERVER_PACKAGES, FRAMEWORK_PACKAGES } from "./check-deps.mjs";

/**
 * The engine-standalone discipline (PLAN.md §15): the Apache-2.0 framework
 * packages must never import the AGPL server/collab ones, so the framework stays
 * dependency-light and cleanly Apache-2.0. This guard is the only thing that
 * keeps that true over time, so it gets real tests.
 */
describe("findForbiddenImports", () => {
  const ossFiles = {
    "packages/engine/src/build.ts": `import { foo } from "@makedown/format";\nimport x from "node:fs";`,
    "packages/format/src/parse.ts": `import { z } from "zod";`,
  };

  it("returns no violations when framework code only imports allowed packages", () => {
    const violations = findForbiddenImports(ossFiles);
    expect(violations).toEqual([]);
  });

  it("flags a framework file that imports a server/collab package", () => {
    const files = {
      ...ossFiles,
      "packages/engine/src/leak.ts": `import { SyncServer } from "@makedown/sync";`,
    };
    const violations = findForbiddenImports(files);
    expect(violations).toEqual([
      { file: "packages/engine/src/leak.ts", imported: "@makedown/sync" },
    ]);
  });

  it("flags subpath imports of a server/collab package", () => {
    const files = {
      "packages/cli/src/x.ts": `import { Thing } from "@makedown/server/dist/api.js";`,
    };
    const violations = findForbiddenImports(files);
    expect(violations).toEqual([
      { file: "packages/cli/src/x.ts", imported: "@makedown/server/dist/api.js" },
    ]);
  });

  it("matches export-from re-exports as well as imports", () => {
    const files = {
      "packages/shared/src/x.ts": `export { Web } from "@makedown/web";`,
    };
    const violations = findForbiddenImports(files);
    expect(violations).toHaveLength(1);
    expect(violations[0].imported).toBe("@makedown/web");
  });

  it("ignores server/collab packages importing each other (allowed direction)", () => {
    // Only framework files are passed to the analyzer; this documents intent.
    expect(SERVER_PACKAGES).toContain("@makedown/sync");
    expect(FRAMEWORK_PACKAGES).toContain("@makedown/engine");
    expect(FRAMEWORK_PACKAGES).not.toContain("@makedown/web");
  });
});
