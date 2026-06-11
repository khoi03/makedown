/**
 * Interactive approval gate for `approval: required` agent artifacts.
 *
 * The engine produces the artifact (a diff) but won't write it until an approver
 * says yes. On a TTY we preview the change and prompt; with no interactive
 * terminal (CI, a pipe) we deny — a build must never silently accept agent file
 * changes. The yes/no parsing and prompt rendering are pure so they're testable
 * without driving a real terminal.
 */
import { createInterface } from "node:readline";
import type { ApprovalRequest } from "@makedown/engine";
import { colorEnabled, makeStyler, type Styler } from "./format.js";

/** How much of the artifact preview (the diff) to show before truncating. */
const PREVIEW_LIMIT = 4000;

/**
 * Interpret a yes/no answer. Only an explicit "y"/"yes" (any case) approves;
 * empty input or anything else denies — the safe default for side-effectful
 * agent output.
 */
export function parseApproval(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

/** Render the approval prompt body (pure; no IO) so it's easy to test. */
export function renderApprovalPrompt(req: ApprovalRequest, s: Styler): string {
  const truncated = req.preview.length > PREVIEW_LIMIT;
  const body = truncated
    ? `${req.preview.slice(0, PREVIEW_LIMIT)}\n${s.dim(`… (${req.preview.length - PREVIEW_LIMIT} more chars)`)}`
    : req.preview;
  return [
    "",
    `${s.yellow("●")} ${s.bold(`Approval required: ${req.target}`)}${s.dim(`  (${req.step} → ${req.output})`)}`,
    s.dim("─── proposed artifact ───"),
    body.trimEnd() || s.dim("(empty)"),
    s.dim("─────────────────────────"),
  ].join("\n");
}

/**
 * Build an approver that previews the artifact and prompts on the TTY. Without
 * an interactive terminal it denies — a CI / piped build must never silently
 * accept agent file changes.
 */
export function createInteractiveApprover(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): (req: ApprovalRequest) => Promise<boolean> {
  const s = makeStyler(colorEnabled());
  return async (req) => {
    if (!input.isTTY) {
      console.error(
        `Skipping ${req.target}: approval required but no interactive terminal. ` +
          "Run `md build` in a TTY to review.",
      );
      return false;
    }
    output.write(`${renderApprovalPrompt(req, s)}\n`);
    const rl = createInterface({ input, output });
    try {
      const answer = await new Promise<string>((resolve) =>
        rl.question(s.bold(`Accept ${req.target}? [y/N] `), resolve),
      );
      return parseApproval(answer);
    } finally {
      rl.close();
    }
  };
}
