import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkspaceStore,
  WorkspaceNotFoundError,
  InvalidWorkspaceIdError,
  loadDoc,
  makeServerContext,
  routerConfigFromEnv,
} from "./workspace.js";

describe("WorkspaceStore", () => {
  let root: string;
  let store: WorkspaceStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdroot-"));
    store = new WorkspaceStore(root);
    await mkdir(join(root, "alpha"), { recursive: true });
    await writeFile(join(root, "alpha", "build.md"), "## target: t\n```yaml\nstep: chat\n```\nx", "utf8");
    await mkdir(join(root, "beta"), { recursive: true });
    await writeFile(join(root, "beta", "build.md"), "## target: u\n```yaml\nstep: chat\n```\ny", "utf8");
    await mkdir(join(root, "not-a-workspace"), { recursive: true }); // no build.md
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a safe id to a directory under the root", () => {
    expect(store.resolve("alpha")).toBe(join(root, "alpha"));
  });

  it.each(["..", "../escape", "a/b", "a\\b", "/abs", ".", "", "with.dot"])(
    "rejects unsafe workspace id %j",
    (id) => {
      expect(() => store.resolve(id)).toThrow(InvalidWorkspaceIdError);
    },
  );

  it("throws WorkspaceNotFoundError for a missing workspace", async () => {
    await expect(store.open("ghost")).rejects.toThrow(WorkspaceNotFoundError);
  });

  it("opens an existing workspace and returns its directory", async () => {
    expect(await store.open("alpha")).toBe(join(root, "alpha"));
  });

  it("lists only directories that contain a build.md", async () => {
    expect((await store.list()).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("loadDoc", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdws-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses the workspace build.md into a doc", async () => {
    await writeFile(
      join(dir, "build.md"),
      "## target: greet\n```yaml\nstep: chat\nmodel: m\noutput: artifacts/g.md\n```\nHi.",
      "utf8",
    );
    const doc = await loadDoc(dir);
    expect(doc.targets.map((t) => t.name)).toEqual(["greet"]);
  });
});

describe("routerConfigFromEnv", () => {
  it("includes only providers whose keys are present", () => {
    const cfg = routerConfigFromEnv({ ANTHROPIC_API_KEY: "sk-a", MAKEDOWN_DEFAULT_PROVIDER: "anthropic" });
    expect(cfg.anthropic?.apiKey).toBe("sk-a");
    expect(cfg.openai).toBeUndefined();
    expect(cfg.defaultProvider).toBe("anthropic");
  });

  it("defaults the provider to anthropic", () => {
    expect(routerConfigFromEnv({}).defaultProvider).toBe("anthropic");
  });
});

describe("makeServerContext", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdctx-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("builds a context pointing at the workspace dir with a CAS and wired hooks", () => {
    const events: string[] = [];
    const ctx = makeServerContext(
      dir,
      {
        onProgress: (e) => events.push(e.type),
        approve: async () => true,
      },
      { env: {} }, // no provider keys -> provider omitted (transform-only still builds)
    );
    expect(ctx.workspaceDir).toBe(dir);
    expect(ctx.cas).toBeDefined();
    expect(ctx.provider).toBeUndefined();
    expect(ctx.onProgress).toBeDefined();
    ctx.onProgress?.({ type: "target-start", target: "x", stale: true });
    expect(events).toEqual(["target-start"]);
  });

  it("wires a provider when an API key is present in env", () => {
    const ctx = makeServerContext(
      dir,
      { onProgress: () => {}, approve: async () => false },
      { env: { ANTHROPIC_API_KEY: "sk-test" } },
    );
    expect(ctx.provider).toBeDefined();
    expect(ctx.agentRunner).toBeDefined();
  });
});
