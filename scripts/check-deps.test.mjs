import { describe, it, expect } from "vitest";
import { findForbiddenImports, COMMERCIAL_PACKAGES, OSS_PACKAGES } from "./check-deps.mjs";

/**
 * The open-core boundary (PLAN.md §15): OSS packages must never import the
 * commercial ones. This guard is the only thing that keeps the boundary clean
 * over time, so it gets real tests.
 */
describe("findForbiddenImports", () => {
  const ossFiles = {
    "packages/engine/src/build.ts": `import { foo } from "@makedown/format";\nimport x from "node:fs";`,
    "packages/format/src/parse.ts": `import { z } from "zod";`,
  };

  it("returns no violations when OSS code only imports allowed packages", () => {
    const violations = findForbiddenImports(ossFiles);
    expect(violations).toEqual([]);
  });

  it("flags an OSS file that imports a commercial package", () => {
    const files = {
      ...ossFiles,
      "packages/engine/src/leak.ts": `import { SyncServer } from "@makedown/sync";`,
    };
    const violations = findForbiddenImports(files);
    expect(violations).toEqual([
      { file: "packages/engine/src/leak.ts", imported: "@makedown/sync" },
    ]);
  });

  it("flags subpath imports of a commercial package", () => {
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

  it("ignores commercial packages importing each other (allowed direction)", () => {
    // Only OSS files are passed to the analyzer; this documents intent.
    expect(COMMERCIAL_PACKAGES).toContain("@makedown/sync");
    expect(OSS_PACKAGES).toContain("@makedown/engine");
    expect(OSS_PACKAGES).not.toContain("@makedown/web");
  });
});
