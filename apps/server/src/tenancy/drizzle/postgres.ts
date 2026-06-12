/**
 * Production Postgres connector. Opens a postgres-js pool, applies the schema
 * DDL (idempotent — safe to run on every boot), and returns a ready
 * {@link TenancyService}. The pglite-tested {@link DrizzleTenancyStore} is the
 * exact code path used here, so the connector itself is a thin, low-risk seam.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { TenancyService } from "../service.js";
import { DrizzleTenancyStore } from "./store.js";
import { schema, SCHEMA_SQL } from "./schema.js";

export interface PostgresTenancy {
  readonly tenancy: TenancyService;
  /** Close the connection pool (call on server shutdown). */
  close(): Promise<void>;
}

/**
 * Connect to Postgres, migrate, and build the tenancy service. Awaited at server
 * startup before listening so the schema exists before the first request.
 */
export async function createPostgresTenancy(databaseUrl: string): Promise<PostgresTenancy> {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql, { schema });
  await sql.unsafe(SCHEMA_SQL);
  const tenancy = new TenancyService(new DrizzleTenancyStore(db));
  return { tenancy, close: () => sql.end() };
}
