import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://learning:learning@localhost:54329/learning";

export const sqlClient = postgres(connectionString, {
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  prepare: false
});

export const db = drizzle(sqlClient, { schema });

export type Db = typeof db;
