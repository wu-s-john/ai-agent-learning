import postgres from "postgres";

const connectionString = process.env.DATABASE_URL ?? "postgres://learning:learning@localhost:54329/learning";
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
