/**
 * Engine-standalone guard (docs/ROADMAP.md §15).
 *
 * Run via `node scripts/check-deps.mjs` (no shebang: it's imported by its test,
 * and a shebang line breaks transform-based importers like vitest).
 *
 * The Apache-2.0 framework packages must run fully standalone (no server, no DB)
 * and must never depend on the AGPL server/collab packages. This keeps the great
 * solo/CI experience intact and the framework cleanly Apache-2.0. This script
 * fails if any framework source file imports (or re-exports from) a server/collab
 * `@makedown/*` package. Run via `pnpm lint:deps`; the pure core is unit-tested
 * in `check-deps.test.ts`.
 */
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/** Apache-2.0 framework packages that must stay standalone. */
export const FRAMEWORK_PACKAGES = [
  "@makedown/shared",
  "@makedown/format",
  "@makedown/providers",
  "@makedown/agents",
  "@makedown/import",
  "@makedown/engine",
  "@makedown/cli",
];

/** AGPL server/collab packages the framework is forbidden from importing. */
export const SERVER_PACKAGES = ["@makedown/sync", "@makedown/web", "@makedown/server"];

const FRAMEWORK_DIRS = ["packages/shared", "packages/format", "packages/providers", "packages/agents", "packages/import", "packages/engine", "packages/cli"];

/** Matches `from "X"` and `import("X")` specifiers. */
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Given a map of `relPath -> fileContents` for framework source files, return
 * every import of a server/collab package. Pure (no IO) so it can be unit-tested.
 *
 * @param {Record<string, string>} files
 * @returns {{ file: string, imported: string }[]}
 */
export function findForbiddenImports(files) {
  const violations = [];
  for (const [file, contents] of Object.entries(files)) {
    for (const match of contents.matchAll(SPECIFIER)) {
      const spec = match[1];
      if (SERVER_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
        violations.push({ file, imported: spec });
      }
    }
  }
  return violations;
}

async function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  /** @type {Record<string, string>} */
  const files = {};
  for (const dir of FRAMEWORK_DIRS) {
    const pattern = join(repoRoot, dir, "src", "**", "*.{ts,tsx,mts,cts}");
    for await (const entry of glob(pattern)) {
      if (entry.includes(".test.") || entry.includes(".d.ts")) continue;
      files[relative(repoRoot, entry).replaceAll("\\", "/")] = await readFile(entry, "utf8");
    }
  }

  const violations = findForbiddenImports(files);
  if (violations.length > 0) {
    console.error("✖ Engine-standalone guard violated — framework packages import server/collab code:\n");
    for (const v of violations) {
      console.error(`  ${v.file}\n    imports ${v.imported}`);
    }
    console.error(`\n${violations.length} violation(s). Framework packages (${FRAMEWORK_PACKAGES.join(", ")})`);
    console.error(`must not depend on server/collab packages (${SERVER_PACKAGES.join(", ")}).`);
    process.exit(1);
  }
  console.log(`✓ Engine-standalone guard clean — ${Object.keys(files).length} framework files scanned, no server/collab imports.`);
}

// Run only when invoked directly, not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
