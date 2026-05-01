import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { resolveDatabaseUrl } from "./url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const migrationsDir = path.join(root, "drizzle");
const connectionString = resolveDatabaseUrl();

const client = postgres(connectionString, { max: 1, prepare: false });

async function main() {
  await client`
    CREATE TABLE IF NOT EXISTS __app_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const [{ exists }] = await client<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM __app_migrations WHERE id = ${file}) AS exists
    `;
    if (exists) continue;

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await client.begin(async (tx) => {
      await tx.unsafe(sql);
      await tx`INSERT INTO __app_migrations (id) VALUES (${file})`;
    });
    console.log(`applied ${file}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
