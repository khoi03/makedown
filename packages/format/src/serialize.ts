/**
 * Serializer: BuildDoc -> `build.md` text. Inverse of the parser for the
 * fields it round-trips. Prose between targets is not preserved (the engine
 * treats it as documentation only).
 */
import { stringify as stringifyYaml } from "yaml";
import {
  cachePolicyToString,
  type BuildDoc,
  type FrontMatter,
  type TargetBlock,
} from "@makedown/shared";

export function serializeBuildDoc(doc: BuildDoc): string {
  const parts: string[] = [];
  const fm = serializeFrontMatter(doc.frontMatter);
  if (fm) parts.push(fm);
  for (const target of doc.targets) {
    parts.push(serializeTarget(target));
  }
  return parts.join("\n\n") + "\n";
}

function serializeFrontMatter(fm: FrontMatter): string | undefined {
  const obj: Record<string, unknown> = {};
  if (fm.version) obj["version"] = fm.version;
  if (fm.defaults) {
    const defaults: Record<string, unknown> = {};
    if (fm.defaults.model) defaults["model"] = fm.defaults.model;
    if (fm.defaults.fallback && fm.defaults.fallback.length > 0)
      defaults["fallback"] = fm.defaults.fallback;
    if (fm.defaults.route) defaults["route"] = fm.defaults.route;
    if (fm.defaults.system) defaults["system"] = fm.defaults.system;
    if (fm.defaults.params) defaults["params"] = fm.defaults.params;
    if (fm.defaults.cache) defaults["cache"] = cachePolicyToString(fm.defaults.cache);
    obj["defaults"] = defaults;
  }
  obj["artifacts_dir"] = fm.artifactsDir;
  obj["sources_dir"] = fm.sourcesDir;
  return `---\n${stringifyYaml(obj).trimEnd()}\n---`;
}

function serializeTarget(target: TargetBlock): string {
  const h = target.header;
  const header: Record<string, unknown> = { inputs: h.inputs, step: h.step };
  if (h.model) header["model"] = h.model;
  if (h.fallback && h.fallback.length > 0) header["fallback"] = h.fallback;
  if (h.route) header["route"] = h.route;
  if (h.system) header["system"] = h.system;
  if (Object.keys(h.params).length > 0) header["params"] = h.params;
  header["output"] = h.output;
  header["cache"] = cachePolicyToString(h.cache);
  if (h.agent) header["agent"] = h.agent;
  if (h.sandbox !== "worktree") header["sandbox"] = h.sandbox;
  if (h.approval !== "none") header["approval"] = h.approval;
  if (h.transform) header["transform"] = h.transform;
  if (h.over) header["over"] = h.over;
  if (h.schema) header["schema"] = h.schema;

  const yaml = stringifyYaml(header).trimEnd();
  return `## target: ${target.name}\n\`\`\`yaml\n${yaml}\n\`\`\`\n${target.body}`;
}
