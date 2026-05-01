import postgres from "postgres";
import { resolveDatabaseUrl } from "./url";

const databaseTarget = process.env.DB_TARGET ?? "unknown";
if (databaseTarget === "prod" && process.env.CONFIRM_PROD_DATABASE_RESET !== "reset-prod") {
  throw new Error("Refusing to reset prod. Set CONFIRM_PROD_DATABASE_RESET=reset-prod to override.");
}

const connectionString = resolveDatabaseUrl();
const client = postgres(connectionString, { max: 1, prepare: false });

async function main() {
  await client`DROP SCHEMA public CASCADE`;
  await client`CREATE SCHEMA public`;
  console.log("database reset");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
