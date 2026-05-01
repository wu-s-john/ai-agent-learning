# AWS RDS Workflow

This repo uses local Docker Postgres for `local` and `test`. The only remote
database target is `prod`, backed by AWS RDS PostgreSQL and 1Password.

## 1Password Items

Create these prod items:

- `ai-agent-army-dev/learning-postgres-prod-app`
- `ai-agent-army-dev/learning-postgres-prod-admin`

Each database credential item needs these fields:

- `hostname`
- `port`
- `database`
- `username`
- `password`
- `sslmode`

Use `sslmode=require` for RDS.

Create `ai-agent-army-dev/learning-rds-prod-config` for RDS deployment
settings. It needs these fields:

- `db-subnet-group-name`
- `vpc-security-group-ids`

The committed prod files in `config/op/*.envmap` contain only 1Password
references and non-secret defaults. Local and test do not use 1Password.

Seed local access to the `ai-agent-army-dev` vault once per machine:

```bash
just load-dev-token
just setup-env
```

`load-dev-token` writes `AI_AGENT_ARMY_DEV_SERVICE_ACCOUNT_TOKEN` to local
`.env`. `setup-env` uses that token to resolve `config/op/prod.envmap` and
`config/op/prod-rds.envmap` into `.env`.

## Prod RDS Deployment

`deploy-prod-db` deploys or updates the RDS instance using CloudFormation:

```bash
CONFIRM_PROD_DEPLOY=1 just deploy-prod-db
```

Before running it, fill `config/op/prod-rds.envmap` with the VPC-specific
settings:

- `RDS_SUBNET_GROUP_NAME`
- `RDS_SECURITY_GROUP_IDS`
- optionally `RDS_ENGINE_VERSION`

The CloudFormation stack uses `ManageMasterUserPassword`, so AWS stores the
master password in Secrets Manager and the stack output includes the secret ARN.
After the instance exists, store the endpoint and the app/admin credentials in
the prod 1Password items listed above.

`config/op/prod.envmap` is the database credential map used by normal remote
DB recipes. It uses the `ai-agent-army-dev` vault for app and admin
credentials. Keep admin credentials limited to bootstrap-only operations.
Prod commands read hydrated `.env` values and fail with the
`load-dev-token` / `setup-env` recovery path if required values are missing or
still unresolved.

## Database Lifecycle

Local and test:

```bash
just db-up-local
just db-migrate-local
just db-seed-local
just db-up-test
just test
```

Prod:

```bash
just load-dev-token
just setup-env
just check-env-prod
CONFIRM_PROD_BOOTSTRAP=1 just db-bootstrap-prod
CONFIRM_PROD_MIGRATE=1 just db-migrate-prod
```

Run the app and checks:

```bash
just dev
just typecheck
just build-local
just test
```

`just test` targets local Docker Postgres on `localhost:54330`. The integration
tests truncate tables, so they must never point at prod.

## Useful Recipes

```bash
just db-url-local
just db-url-test
just db-url-prod
just db-url-admin-prod
just db-check-local
just db-check-prod
just db-shell-local
just db-shell-prod
just prod-release
```

`prod-release` runs typecheck, a prod-env build, and the guarded prod migration.
