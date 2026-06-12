/**
 * Provenance dual-write helpers. The engine writes canonical provenance into the
 * per-workspace CAS (unchanged, Apache-2.0). After a build, the server projects
 * the just-built targets' records into the tenancy provenance *index* — a
 * denormalized, queryable copy that is always re-derivable from the CAS.
 */
import type { Provenance } from "@makedown/shared";
import type { ProvenanceInput } from "./tenancy/index.js";
import { getProvenance } from "./artifacts.js";

/** Project a canonical CAS provenance record into a flat index row (pure). */
export function toProvenanceInput(prov: Provenance, workspaceId: string): ProvenanceInput {
  return {
    id: prov.id,
    workspaceId,
    target: prov.target,
    step: prov.step,
    model: prov.model ?? null,
    tokensInput: prov.tokens?.input ?? 0,
    tokensOutput: prov.tokens?.output ?? 0,
    costUsd: prov.costUsd ?? 0,
    producedAt: prov.producedAt,
  };
}

/**
 * Read the provenance for the given (freshly built) targets from the CAS and map
 * to index rows. Targets without a record are skipped (best-effort projection).
 */
export async function collectProvenanceRows(
  dir: string,
  workspaceId: string,
  targets: readonly string[],
): Promise<ProvenanceInput[]> {
  const rows: ProvenanceInput[] = [];
  for (const target of targets) {
    const prov = await getProvenance(dir, target);
    if (prov) rows.push(toProvenanceInput(prov, workspaceId));
  }
  return rows;
}
