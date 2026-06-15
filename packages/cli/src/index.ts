#!/usr/bin/env node
/** `md` — the Makedown CLI. */
import { Command } from "commander";
import {
  cmdBuild,
  cmdCost,
  cmdGraph,
  cmdImport,
  cmdInit,
  cmdRender,
  cmdShare,
  cmdStatus,
  cmdWhy,
} from "./commands.js";

const program = new Command();

program
  .name("md")
  .description("Make for LLM workflows — incremental, content-addressed builds over Markdown.")
  .version("0.0.0");

program
  .command("init")
  .description("Scaffold a sample workspace (build.md + sources/)")
  .argument("[dir]", "workspace directory")
  .action(cmdInit);

program
  .command("status")
  .description("Show which targets are stale and why")
  .argument("[dir]", "workspace directory")
  .action(cmdStatus);

program
  .command("build")
  .description("Incrementally build — only stale targets recompute")
  .argument("[dir]", "workspace directory")
  .action(cmdBuild);

program
  .command("graph")
  .description("Print the build graph in execution order")
  .argument("[dir]", "workspace directory")
  .action(cmdGraph);

program
  .command("import")
  .description("Convert a file (PDF, DOCX, PPTX, XLSX, HTML, …) to a Markdown source via MarkItDown")
  .argument("<file>", "source file to convert")
  .argument("[dir]", "workspace directory")
  .option("-o, --out <file>", "output path inside the workspace (default: sources/<name>.md)")
  .action((file: string, dir: string | undefined, opts: { out?: string }) =>
    cmdImport(file, { dir, out: opts.out }),
  );

program
  .command("render")
  .description("Print the exact system + user prompt a target would send (no model call)")
  .argument("<target>", "target name")
  .argument("[dir]", "workspace directory")
  .action(cmdRender);

program
  .command("why")
  .description("Show full provenance for a target's artifact")
  .argument("<target>", "target name")
  .argument("[dir]", "workspace directory")
  .action(cmdWhy);

program
  .command("cost")
  .description("Estimate what a build would run (dry run)")
  .argument("[dir]", "workspace directory")
  .action(cmdCost);

program
  .command("share")
  .description("Export a built artifact to a self-contained, read-only HTML file")
  .argument("<target>", "target name")
  .argument("[dir]", "workspace directory")
  .option("-o, --out <file>", "output file path (default: <output>.share.html)")
  .option("--provenance", "include provenance (model, inputs, cost) in the export")
  .action((target: string, dir: string | undefined, opts: { out?: string; provenance?: boolean }) =>
    cmdShare(target, { dir, out: opts.out, provenance: opts.provenance }),
  );

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
