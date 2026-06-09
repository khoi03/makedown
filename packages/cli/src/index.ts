#!/usr/bin/env node
/** `md` — the Makedown CLI. */
import { Command } from "commander";
import {
  cmdBuild,
  cmdCost,
  cmdGraph,
  cmdInit,
  cmdRender,
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

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
