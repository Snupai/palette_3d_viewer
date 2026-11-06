# SQLite on a single server

> **Superseded** by [ADR 0009](0009-postgres-container.md): PostgreSQL in a container (Docker/Podman) instead of a SQLite file.

The first server-backed version runs on a single host with durable local storage and a SQLite database in WAL mode; `PALETTE_DB_PATH` sets the database path. This matches operation on the plant network and avoids the additional operational requirements of a distributed database. Multiple distributed writer instances are not planned.

Hourly consistent SQLite backups to a separate storage volume with seven days of retention and a restore test are confirmed as the target; this accepts a possible data loss of up to one hour. As explicitly requested, this part is handled only as the last implementation step. The backup function is currently not implemented.
