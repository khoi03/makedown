/**
 * Dependency-free terminal styling and value formatting for the `md` CLI.
 *
 * Color is disabled when `NO_COLOR` is set, the stream is not a TTY, or
 * `TERM=dumb` — and force-enabled with `FORCE_COLOR`. Keeping this in-repo
 * avoids a dependency in the OSS CLI (the lock-in-free ethos).
 */

const ANSI = {
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
} as const;

export interface ColorEnv {
  readonly NO_COLOR?: string;
  readonly FORCE_COLOR?: string;
  readonly TERM?: string;
}

/** Decide whether ANSI color should be emitted for the given env + stream. */
export function colorEnabled(
  env: ColorEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): boolean {
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  return isTTY;
}

export type Styler = Readonly<Record<keyof typeof ANSI, (text: string) => string>> & {
  readonly enabled: boolean;
};

/** Build a styler whose functions wrap text in ANSI codes only when enabled. */
export function makeStyler(enabled: boolean): Styler {
  const out: Record<string, unknown> = { enabled };
  for (const [name, code] of Object.entries(ANSI)) {
    out[name] = (text: string): string => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);
  }
  return out as Styler;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Visible length of text, ignoring ANSI escape codes (for column padding). */
export function visibleLength(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

/** Right-pad to a visible width, accounting for embedded ANSI codes. */
export function padCell(text: string, width: number): string {
  const pad = width - visibleLength(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}

/** Format a USD amount compactly. Undefined → em dash; tiny but non-zero → "<$0.01". */
export function formatUsd(amount: number | undefined): string {
  if (amount === undefined) return "—";
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}

/** Format a token count with k/M suffixes for readability. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
