import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./url";

const connectionString = resolveDatabaseUrl();

export const sqlClient = postgres(connectionString, {
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  prepare: false
});

export const db = drizzle(sqlClient, { schema });

export type Db = typeof db;
