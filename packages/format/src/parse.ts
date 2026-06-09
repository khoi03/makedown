/**
 * Parser for the `build.md` format (see SPEC.md). Turns untrusted Markdown text
 * into a typed BuildDoc. Line-based and dependency-light by design.
 */
import { parse as parseYaml } from "yaml";
import {
  recipeHeaderSchema,
  frontMatterSchema,
  parseCachePolicy,
  isValidTargetName,
  type BuildDoc,
  type FrontMatter,
  type RecipeHeader,
  type TargetBlock,
  type RawRecipeHeader,
  type RawFrontMatter,
} from "@makedown/shared";

export interface ParseOptions {
  /** Reject unknown fields and undeclared `{{refs}}`. Default: true. */
  readonly strict?: boolean;
}

export class BuildDocParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = "BuildDocParseError";
  }
}

const TARGET_HEADING_RE = /^##\s+target:\s*(.+?)\s*$/;
const FENCE_RE = /^```/;
const YAML_FENCE_RE = /^```ya?ml\s*$/i;
const REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Parse a full `build.md` document into a typed BuildDoc. */
export function parseBuildDoc(text: string, opts: ParseOptions = {}): BuildDoc {
  const strict = opts.strict ?? true;
  const { frontMatterText, body } = splitFrontMatter(text);
  const frontMatter = normalizeFrontMatter(frontMatterText);
  const targets = extractTargets(body, frontMatter, strict);
  assertUniqueNames(targets);
  return { frontMatter, targets };
}

function splitFrontMatter(text: string): { frontMatterText?: string; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { body: text };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      return {
        frontMatterText: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  throw new BuildDocParseError("Unterminated front matter (missing closing '---')", 1);
}

function normalizeFrontMatter(frontMatterText?: string): FrontMatter {
  const raw: RawFrontMatter = frontMatterSchema.parse(
    frontMatterText ? (parseYaml(frontMatterText) ?? {}) : {},
  );
  return {
    version: raw.version,
    defaults: raw.defaults
      ? {
          model: raw.defaults.model,
          params: raw.defaults.params,
          cache: raw.defaults.cache ? parseCachePolicy(raw.defaults.cache) : undefined,
        }
      : undefined,
    artifactsDir: raw.artifacts_dir,
    sourcesDir: raw.sources_dir,
  };
}

interface RawTarget {
  readonly name: string;
  readonly yamlText: string;
  readonly body: string;
  readonly headingLine: number;
}

function extractTargets(body: string, fm: FrontMatter, strict: boolean): TargetBlock[] {
  const lines = body.split(/\r?\n/);
  const raws: RawTarget[] = [];

  let i = 0;
  while (i < lines.length) {
    const heading = TARGET_HEADING_RE.exec(lines[i] ?? "");
    if (!heading) {
      i++;
      continue;
    }
    const name = (heading[1] ?? "").trim();
    const headingLine = i + 1;
    i++;

    // Skip blank lines, then require a yaml fence.
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
    if (i >= lines.length || !YAML_FENCE_RE.test(lines[i] ?? "")) {
      throw new BuildDocParseError(
        `Target "${name}" must be followed by a \`\`\`yaml recipe header`,
        headingLine,
      );
    }
    i++; // consume opening fence

    const yamlStart = i;
    while (i < lines.length && !FENCE_RE.test(lines[i] ?? "")) i++;
    if (i >= lines.length) {
      throw new BuildDocParseError(`Unterminated yaml header in target "${name}"`, headingLine);
    }
    const yamlText = lines.slice(yamlStart, i).join("\n");
    i++; // consume closing fence

    // Body runs until the next target heading or EOF.
    const bodyStart = i;
    while (i < lines.length && !TARGET_HEADING_RE.test(lines[i] ?? "")) i++;
    const blockBody = lines.slice(bodyStart, i).join("\n").trim();

    raws.push({ name, yamlText, body: blockBody, headingLine });
  }

  return raws.map((raw) => toTargetBlock(raw, fm, strict));
}

function toTargetBlock(raw: RawTarget, fm: FrontMatter, strict: boolean): TargetBlock {
  if (!isValidTargetName(raw.name)) {
    throw new BuildDocParseError(
      `Invalid target name "${raw.name}" (must match /^[a-z0-9][a-z0-9_-]*$/)`,
      raw.headingLine,
    );
  }

  let parsed: RawRecipeHeader;
  try {
    parsed = recipeHeaderSchema.parse(parseYaml(raw.yamlText) ?? {});
  } catch (err) {
    throw new BuildDocParseError(
      `Invalid recipe header in target "${raw.name}": ${(err as Error).message}`,
      raw.headingLine,
    );
  }

  const header = mergeDefaults(raw.name, parsed, fm);

  if (strict) {
    assertRefsDeclared(raw.name, raw.body, header.inputs, raw.headingLine);
  }

  return { name: raw.name, header, body: raw.body };
}

function mergeDefaults(name: string, raw: RawRecipeHeader, fm: FrontMatter): RecipeHeader {
  return {
    inputs: raw.inputs,
    step: raw.step,
    model: raw.model ?? fm.defaults?.model,
    params: { ...(fm.defaults?.params ?? {}), ...raw.params },
    output: raw.output ?? `${fm.artifactsDir}/${name}.md`,
    cache: raw.cache ? parseCachePolicy(raw.cache) : (fm.defaults?.cache ?? { kind: "deterministic" }),
    agent: raw.agent,
    sandbox: raw.sandbox,
    approval: raw.approval,
    transform: raw.transform,
    over: raw.over,
    schema: raw.schema,
  };
}

/** Strip an optional `:fn(args)` transform suffix to get the bare ref. SPEC §5. */
export function bareRef(ref: string): string {
  const colon = ref.indexOf(":");
  return colon === -1 ? ref : ref.slice(0, colon);
}

/** Collect every `{{ref}}` used in a prompt body (with suffixes stripped). */
export function refsInBody(body: string): string[] {
  const refs = new Set<string>();
  for (const match of body.matchAll(REF_RE)) {
    refs.add(bareRef((match[1] ?? "").trim()));
  }
  return [...refs];
}

function assertRefsDeclared(
  name: string,
  body: string,
  inputs: readonly string[],
  line: number,
): void {
  const declared = new Set(inputs.map(bareRef));
  for (const ref of refsInBody(body)) {
    if (!declared.has(ref)) {
      throw new BuildDocParseError(
        `Target "${name}" references {{${ref}}} which is not declared in inputs`,
        line,
      );
    }
  }
}

function assertUniqueNames(targets: readonly TargetBlock[]): void {
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.name)) {
      throw new BuildDocParseError(`Duplicate target name "${t.name}"`);
    }
    seen.add(t.name);
  }
}
