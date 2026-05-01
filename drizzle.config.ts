import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./src/db/url";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl()
  }
});
