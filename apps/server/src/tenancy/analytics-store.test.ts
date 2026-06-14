import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleTenancyStore } from "./drizzle/store.js";
import { schema, SCHEMA_SQL } from "./drizzle/schema.js";
import { InMemoryTenancyStore } from "./memory-store.js";
import type { TenancyStore } from "./store.js";
import type { ProvenanceRow } from "./types.js";
import { NO_MODEL_KEY } from "./analytics.js";

/**
 * Aggregation is verified against BOTH stores from one suite, so the in-memory
 * reduction and the Postgres `GROUP BY` (run on pglite — real Postgres in WASM)
 * can never drift. The expectations are identical; only the store differs.
 */

function row(over: Partial<ProvenanceRow> & Pick<ProvenanceRow, "id">): ProvenanceRow {
  return {
    workspaceId: "alpha",
    orgId: "org1",
    target: "summary",
    step: "chat",
    model: "claude-opus-4-8",
    tokensInput: 100,
    tokensOutput: 50,
    costUsd: 0.01,
    producedAt: "2026-06-10T08:00:00.000Z",
    ...over,
  };
}

/** Seed two workspaces, two models, two targets, across three days, plus noise. */
async function seed(store: TenancyStore): Promise<void> {
  await store.upsertProvenance(row({ id: "a1", workspaceId: "alpha", model: "claude-opus-4-8", target: "summary", tokensInput: 100, tokensOutput: 50, costUsd: 0.01, producedAt: "2026-06-10T08:00:00.000Z" }));
  await store.upsertProvenance(row({ id: "a2", workspaceId: "alpha", model: "gpt-4o", target: "review", tokensInput: 200, tokensOutput: 80, costUsd: 0.02, producedAt: "2026-06-10T20:00:00.000Z" }));
  await store.upsertProvenance(row({ id: "b1", workspaceId: "beta", model: "claude-opus-4-8", target: "summary", tokensInput: 300, tokensOutput: 120, costUsd: 0.05, producedAt: "2026-06-11T09:00:00.000Z" }));
  // A transform step: no model, zero cost — must still count as a run.
  await store.upsertProvenance(row({ id: "b2", workspaceId: "beta", step: "transform", model: null, target: "merge", tokensInput: 0, tokensOutput: 0, costUsd: 0, producedAt: "2026-06-12T09:00:00.000Z" }));
  // Noise: a different org must never leak into org1's aggregates.
  await store.upsertProvenance(row({ id: "z1", workspaceId: "gamma", orgId: "org2", costUsd: 99, producedAt: "2026-06-11T09:00:00.000Z" }));
}

function runSuite(name: string, makeStore: () => Promise<TenancyStore> | TenancyStore, teardown?: () => Promise<void>): void {
  describe(`aggregateProvenanceForOrg — ${name}`, () => {
    let store: TenancyStore;
    beforeEach(async () => {
      store = await makeStore();
      await seed(store);
    });
    afterEach(async () => {
      await teardown?.();
    });

    it("totals only the org's rows (no cross-org leakage)", async () => {
      const a = await store.aggregateProvenanceForOrg("org1");
      expect(a.totals).toEqual({ tokensInput: 600, tokensOutput: 250, costUsd: 0.08, runs: 4 });
    });

    it("returns empty breakdowns for an org with no rows", async () => {
      const a = await store.aggregateProvenanceForOrg("org-empty");
      expect(a.totals).toEqual({ tokensInput: 0, tokensOutput: 0, costUsd: 0, runs: 0 });
      expect(a.byWorkspace).toEqual([]);
      expect(a.byModel).toEqual([]);
      expect(a.byTarget).toEqual([]);
      expect(a.byDay).toEqual([]);
    });

    it("groups by workspace", async () => {
      const a = await store.aggregateProvenanceForOrg("org1");
      const byWs = Object.fromEntries(a.byWorkspace.map((b) => [b.key, b]));
      expect(byWs["alpha"]).toMatchObject({ runs: 2, costUsd: 0.03 });
      expect(byWs["beta"]).toMatchObject({ runs: 2, costUsd: 0.05 });
      expect(byWs["gamma"]).toBeUndefined();
    });

    it("groups by model, mapping a null model to the (none) sentinel", async () => {
      const a = await store.aggregateProvenanceForOrg("org1");
      const byModel = Object.fromEntries(a.byModel.map((b) => [b.key, b]));
      expect(byModel["claude-opus-4-8"]).toMatchObject({ runs: 2, costUsd: 0.06 });
      expect(byModel["gpt-4o"]).toMatchObject({ runs: 1, costUsd: 0.02 });
      expect(byModel[NO_MODEL_KEY]).toMatchObject({ runs: 1, costUsd: 0 });
    });

    it("groups by target", async () => {
      const a = await store.aggregateProvenanceForOrg("org1");
      const byTarget = Object.fromEntries(a.byTarget.map((b) => [b.key, b]));
      expect(byTarget["summary"]).toMatchObject({ runs: 2, costUsd: 0.06 });
      expect(byTarget["review"]).toMatchObject({ runs: 1 });
      expect(byTarget["merge"]).toMatchObject({ runs: 1 });
    });

    it("groups by calendar day, ascending", async () => {
      const a = await store.aggregateProvenanceForOrg("org1");
      expect(a.byDay.map((b) => b.key)).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
      expect(a.byDay[0]).toMatchObject({ runs: 2, costUsd: 0.03 }); // both alpha rows
    });

    it("filters to a half-open [from, to) window", async () => {
      // Only 2026-06-11 rows: beta/summary.
      const a = await store.aggregateProvenanceForOrg("org1", {
        from: "2026-06-11T00:00:00.000Z",
        to: "2026-06-12T00:00:00.000Z",
      });
      expect(a.totals).toEqual({ tokensInput: 300, tokensOutput: 120, costUsd: 0.05, runs: 1 });
      expect(a.byDay.map((b) => b.key)).toEqual(["2026-06-11"]);
    });

    it("applies an open-ended lower bound", async () => {
      const a = await store.aggregateProvenanceForOrg("org1", { from: "2026-06-12T00:00:00.000Z" });
      expect(a.totals.runs).toBe(1);
      expect(a.byTarget.map((b) => b.key)).toEqual(["merge"]);
    });
  });
}

runSuite("InMemoryTenancyStore", () => new InMemoryTenancyStore());

describe("DrizzleTenancyStore wrapper", () => {
  let client: PGlite;
  runSuite(
    "DrizzleTenancyStore (pglite)",
    async () => {
      client = new PGlite();
      const db = drizzle(client, { schema });
      await client.exec(SCHEMA_SQL);
      return new DrizzleTenancyStore(db);
    },
    async () => {
      await client.close();
    },
  );
});
