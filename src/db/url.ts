type Env = Record<string, string | undefined>;

function firstPresent(env: Env, keys: string[]) {
  for (const key of keys) {
    const value = env[key];
    if (value) return value;
  }
  return undefined;
}

function buildDatabaseUrlFromEnv(env: Env, envPrefix = "") {
  const prefix = envPrefix ? `${envPrefix}_` : "";
  const host = firstPresent(env, envPrefix ? [`${prefix}HOST`, `${prefix}PGHOST`] : ["PGHOST"]);
  const port = firstPresent(env, envPrefix ? [`${prefix}PORT`, `${prefix}PGPORT`] : ["PGPORT"]) ?? "5432";
  const database = firstPresent(env, envPrefix ? [`${prefix}DATABASE`, `${prefix}PGDATABASE`] : ["PGDATABASE"]);
  const user = firstPresent(env, envPrefix ? [`${prefix}USER`, `${prefix}PGUSER`] : ["PGUSER"]);
  const password = firstPresent(env, envPrefix ? [`${prefix}PASSWORD`, `${prefix}PGPASSWORD`] : ["PGPASSWORD"]);
  const sslmode = firstPresent(env, envPrefix ? [`${prefix}SSLMODE`, `${prefix}PGSSLMODE`] : ["PGSSLMODE"]);

  if (!host || !database || !user || !password) return undefined;

  const url = new URL(`postgresql://${host}:${port}`);
  url.username = user;
  url.password = password;
  url.pathname = `/${encodeURIComponent(database)}`;
  if (sslmode) url.searchParams.set("sslmode", sslmode);
  return url.toString();
}

function readDatabaseUrl(env: Env, envPrefix = "") {
  if (!envPrefix) return env.DATABASE_URL;
  return env[`${envPrefix}_DATABASE_URL`] ?? env[`${envPrefix}_URL`];
}

export function resolveDatabaseUrl(options: {
  databaseUrl?: string;
  env?: Env;
  envPrefix?: string;
} = {}) {
  const env = options.env ?? process.env;
  const envPrefix = options.envPrefix ?? "";
  const url = options.databaseUrl ?? readDatabaseUrl(env, envPrefix) ?? buildDatabaseUrlFromEnv(env, envPrefix);

  if (!url) {
    const hint = envPrefix ? `${envPrefix}_DATABASE_URL or ${envPrefix}_*` : "DATABASE_URL or PG*";
    throw new Error(`PostgreSQL credentials are required. Set ${hint} environment variables.`);
  }

  if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
    throw new Error("Only PostgreSQL is supported. Database URL must start with postgres:// or postgresql://.");
  }

  return url;
}
