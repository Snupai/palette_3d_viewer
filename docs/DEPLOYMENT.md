# Deployment with Docker or Podman

The existing `compose.yaml` starts PostgreSQL 17, the database migration,
the website, and hourly backups. Run the following commands in the
repository directory. Bun does not need to be installed on the host for this;
the image build installs the dependencies itself.

## Prerequisites

- Docker with Compose, or Podman with an installed Compose provider.
  Check with `docker compose version` or `podman compose version`, respectively.
- On Windows/macOS the container VM must be running (Docker Desktop or Podman
  Desktop). If needed, create a new Podman VM with `podman machine init` and
  start it with `podman machine start`.
- Free local ports 3000 and 5432, plus storage for images, database, and backups.

## Configuration

Create a `.env` in the repository, or extend an existing one:

```dotenv
PALETTE_STORAGE_MODE=server
PALETTE_DB_PASSWORD=ENTER_A_LONG_RANDOM_PASSWORD_HERE
PALETTE_APP_PORT=3000
PALETTE_DB_PORT=5432
PALETTE_BACKUP_DIR=./backups
```

Replace the password before the first start. Allowed characters are
`A-Z a-z 0-9 - . _ ~`, because Compose inserts it directly into the database URL.
The `.env` stays local and is not checked in. `DATABASE_URL` is set
automatically for the containers.

`PALETTE_STORAGE_MODE=server` must also remain set for later builds:
without this setting, the website stores data in the browser by default.
The Compose variable has a different name than the setting for a direct
Next.js start (`NEXT_PUBLIC_PALETTE_STORAGE_MODE`).

Create the backup directory before starting. PowerShell:

```powershell
New-Item -ItemType Directory -Force backups
```

Linux/macOS: `mkdir -p backups`. With a different `PALETTE_BACKUP_DIR`, create
that directory instead; for permanent operation, use a separate disk. Under
Docker/Linux, adjust `PALETTE_BACKUP_USER=1000:1000` to the directory's owner
if necessary.

## Start with Docker

```sh
docker compose up -d --build
docker compose ps -a
docker compose logs migrate
docker compose run --rm migrate node admin.mjs init
```

## Start with Podman

```sh
podman compose up -d --build
podman compose ps -a
podman compose logs migrate
podman compose run --rm migrate node admin.mjs init
```

Both variants build the same images. `migrate` must finish successfully with exit
code 0; `app` starts afterwards. `db`, `app`, and, after the first backup, also
`backup` should be healthy. The admin command prompts for the password with hidden
input. Then open the website at <http://localhost:3000> and sign in.

## Rolling out changes and stopping

After changes to the code or the build settings:

```sh
docker compose up -d --build
```

For Podman, replace `docker` with `podman` in each case.
`PALETTE_DISABLE_AI_FEATURES` is also a build setting. After changes to
runtime settings such as `SHEET_EXTRACTION_URL`, `docker compose up -d` is enough.
A plain `restart` picks up neither new code nor changed environment variables.

`docker compose down` stops the stack and keeps the database volume.
**Do not run `down -v`** if the data should be kept.
A new `PALETTE_DB_PASSWORD` in `.env` does not change the password of an already
initialized PostgreSQL database; a password rotation must also be performed in
PostgreSQL.

## Backups and restore

```sh
docker compose run --rm backup once
docker compose logs backup
```

A restore replaces the entire database. First bring the stack to the same
code version as the backup and stop the writing services:

```sh
docker compose stop app backup
docker compose run --rm backup restore palette-20261105T140000Z.dump --yes
docker compose up -d
```

Replace the example file name with an existing file in the backup directory.
Details on retention and restore are in the
[README](../README.md#backups-and-restore).

## Access on the plant network

Compose binds the website and the database exclusively to `127.0.0.1`.
For other machines, put an HTTPS reverse proxy on the host in front of the website,
with a certificate trusted by the clients and forwarding
to `http://127.0.0.1:3000`. The database remains bound locally.
Authenticated operation requires HTTPS according to [ADR 0008](adr/0008-https-authentication.md);
the HTTP exception applies only to local development via `localhost`.

## Optional: local image import with llama.cpp

Add to `.env`:

```dotenv
SHEET_EXTRACTION_API=openai
SHEET_EXTRACTION_URL=http://host.docker.internal:8080
SHEET_EXTRACTION_API_KEY=YOUR_MODEL_SERVER_KEY
```

Under Podman, use `http://host.containers.internal:8080` instead.
The model server must be reachable from the container; `localhost` in the container
refers to the container itself. llama.cpp requires a vision model with a
matching `--mmproj`; in router mode, also set `SHEET_EXTRACTION_MODEL`.
Then run `compose up -d` with the chosen engine.

## Troubleshooting

- `compose logs app migrate db` shows build-independent startup and connection errors.
- If ports are in use, change `PALETTE_APP_PORT` or `PALETTE_DB_PORT` and run `up -d`
  again.
- If the Podman Compose provider is missing, install it and first run
  `podman compose version` successfully.
- If backups are missing, check the directory, write permissions, and
  `compose logs backup`. The first backup can take some time.
