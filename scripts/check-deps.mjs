/**
 * Open-core boundary guard (PLAN.md §15).
 *
 * Run via `node scripts/check-deps.mjs` (no shebang: it's imported by its test,
 * and a shebang line breaks transform-based importers like vitest).
 *
 * The OSS packages (Apache-2.0) must run fully standalone and must never depend
 * on the commercial packages. This script fails if any OSS source file imports
 * (or re-exports from) a commercial `@makedown/*` package. Run via
 * `pnpm lint:deps`; the pure core is unit-tested in `check-deps.test.mjs`.
 */
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/** Apache-2.0 packages that must not reach into the commercial layer. */
export const OSS_PACKAGES = [
  "@makedown/shared",
  "@makedown/format",
  "@makedown/providers",
  "@makedown/agents",
  "@makedown/engine",
  "@makedown/cli",
];

/** Proprietary packages OSS code is forbidden from importing. */
export const COMMERCIAL_PACKAGES = ["@makedown/sync", "@makedown/web", "@makedown/server"];

const OSS_DIRS = ["packages/shared", "packages/format", "packages/providers", "packages/agents", "packages/engine", "packages/cli"];

/** Matches `from "X"` and `import("X")` specifiers. */
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Given a map of `relPath -> fileContents` for OSS source files, return every
 * import of a commercial package. Pure (no IO) so it can be unit-tested.
 *
 * @param {Record<string, string>} files
 * @returns {{ file: string, imported: string }[]}
 */
export function findForbiddenImports(files) {
  const violations = [];
  for (const [file, contents] of Object.entries(files)) {
    for (const match of contents.matchAll(SPECIFIER)) {
      const spec = match[1];
      if (COMMERCIAL_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
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
  for (const dir of OSS_DIRS) {
    const pattern = join(repoRoot, dir, "src", "**", "*.{ts,tsx,mts,cts}");
    for await (const entry of glob(pattern)) {
      if (entry.includes(".test.") || entry.includes(".d.ts")) continue;
      files[relative(repoRoot, entry).replaceAll("\\", "/")] = await readFile(entry, "utf8");
    }
  }

  const violations = findForbiddenImports(files);
  if (violations.length > 0) {
    console.error("✖ Open-core boundary violated — OSS packages import commercial code:\n");
    for (const v of violations) {
      console.error(`  ${v.file}\n    imports ${v.imported}`);
    }
    console.error(`\n${violations.length} violation(s). OSS packages (${OSS_PACKAGES.join(", ")})`);
    console.error(`must not depend on commercial packages (${COMMERCIAL_PACKAGES.join(", ")}).`);
    process.exit(1);
  }
  console.log(`✓ Open-core boundary clean — ${Object.keys(files).length} OSS files scanned, no commercial imports.`);
}

// Run only when invoked directly, not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
