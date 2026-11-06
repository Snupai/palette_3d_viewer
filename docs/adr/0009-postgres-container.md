# PostgreSQL in a container instead of a SQLite file

Supersedes [ADR 0001](0001-local-sqlite-server.md).

The server-backed version stores its data in PostgreSQL, which is started as a container via a `compose.yaml` in the repository. The file works unchanged with Docker Compose and Podman (`podman compose`, including rootless); images are therefore specified fully qualified (e.g. `docker.io/library/postgres:17`) and pinned to a major version. The data lives in a named volume; the database port is reachable only on the host or within the Compose network, not on the factory network. The app connects via `DATABASE_URL`; `PALETTE_DB_PATH` is dropped. This makes the database reproducibly startable with a single command, independent of the host's file system, and real transactions and locks are available for the atomic version check ([ADR 0006](0006-optimistic-concurrency.md)).

A single host on the factory network, without distributed write instances or replication, still applies. Drizzle remains the schema, migration and query layer; the generic JSON record table according to [ADR 0004](0004-generic-planner-records.md) uses `jsonb`. The app itself is shipped as a container in the same Compose file: a multi-stage `Dockerfile` (Bun, Next.js standalone output, fully qualified base images, non-root runtime) provides the app and a one-off `migrate` service that applies the Drizzle migrations as soon as the database is healthy; the app starts only after a successful migration. As a result, `PALETTE_STORAGE_MODE=server docker compose up -d --build` or `PALETTE_STORAGE_MODE=server podman compose up -d --build` starts the database, migrations, app and hourly `backup` service with a single command. Without `PALETTE_STORAGE_MODE=server`, the app build defaults to browser-local storage and does not use the database. Set `PALETTE_DB_PASSWORD` before initializing a shared installation; `PALETTE_DB_PORT` and `PALETTE_APP_PORT` configure the host ports (defaults 5432 and 3000). The app port, too, is bound only to `127.0.0.1` until HTTPS according to [ADR 0008](0008-https-authentication.md) is in place.

Automated tests must not require a running container: server tests run in the Node environment against an in-process PostgreSQL instance (PGlite) with the same Drizzle migrations, so that `bun run test:run` and CI work without Docker or Podman. Operation against the container is covered by the Compose file and the migration commands.

The backup goal from ADR 0001 remains in place but changes tooling: hourly consistent backups via `pg_dump` to a separate storage medium, seven days of retention, and a tested restore path; a data loss of up to one hour is accepted. This part remains the last implementation step.

Implementation status: backups and restore are now implemented. The Compose
`backup` service runs `scripts/pg-backup.sh` (`loop`, `once`, `health`, `restore`)
with `PALETTE_BACKUP_DIR` (default `./backups`),
`PALETTE_BACKUP_INTERVAL_SECONDS=3600` and `PALETTE_BACKUP_RETENTION_DAYS=7`.
`bun run db:backup` creates an extra dump; `bun run db:restore <file> --yes`
restores one after stopping both `app` and `backup`. The restore path is covered
by `src/server/db/pgBackupScript.node.test.ts`. See the
[deployment guide](../DEPLOYMENT.md#backups-and-restore) for the operator procedure.
