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

With `just` installed, the repository's `justfile` provides shortcuts without
requiring Bun on the host. Podman is the default; `.env` is loaded automatically:

```sh
just up
just status
just admin-init
just logs app
just down
```

Run `just` to list all commands, including `db-up`, `backup`,
`restore <dump-file> --yes`, and `admin-reset-password <username>`.
Before restoring, stop the app and backup services as described below.
For Docker, use `CONTAINER_ENGINE=docker just up` (and the same prefix for
other commands).

Alternatively, run Compose directly:

```sh
podman compose up -d --build
podman compose ps -a
podman compose logs migrate
podman compose run --rm migrate node admin.mjs init
```

Both variants build the same images. `migrate` must finish successfully with exit
code 0; `app` starts afterwards. `db`, `app`, and, after the first backup, also
`backup` should be healthy. The admin command prompts for the password with hidden
input. The website is reachable at <http://localhost:3000> for anonymous use.
Before signing in, configure HTTPS as described under
[Access on the plant network](#access-on-the-plant-network).

## Plans, sign-in and shared browsers

In server mode, server plans and the Werkskatalog are anonymously readable.
Writing server plans requires sign-in and permission; catalog writes require an
admin. After creating the first admin, sign in over HTTPS and open `/admin` to
create further users or reset their passwords.

Anonymous users can prepare Browserpläne without signing in. These plans live
only in that browser profile and origin, in the separate `pallets-db:browser`
IndexedDB; they are not included in PostgreSQL backups. Clearing browser data
can lose unpublished plans. Server outages or expired sessions never redirect
server-plan saves into this local inventory.

After sign-in, the synchronization popup asks for plan selection and explicit
publication consent before uploading. Signing in or closing the popup alone
publishes nothing. For conflicts, users can keep the server version, replace it
with the local version when permitted, save a new copy, or postpone. Declined or
postponed plans stay local for a later attempt. After confirmed synchronization,
the accepted local payload is removed and a server/account-specific link remains;
a newer local edit made during synchronization is retained.

Publishing makes the plan anonymously readable, searchable and exportable on
this server, including file/product names and the original `.rob` text verbatim.
Unsynchronized Browserpläne belong to the browser inventory, not to an account:
anyone using the same browser profile can see them, and the next person to sign
in can publish them under their account. Signing out does not delete untouched
Browserpläne. Use separate browser profiles for sensitive work on shared machines.
Legacy local-mode data has a separate explicit import that retains its originals.
See [ADR 0010](adr/0010-browser-local-plans.md) for the storage and consent rules.

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
code version as the backup and stop both the app and the hourly backup loop:

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
sessions last 12 hours and the session cookie is always `Secure`, except in
`NODE_ENV=development` on `localhost` or loopback. Production containers and
`bun run start` / `bun run preview` require HTTPS even on localhost; the plain
HTTP exception applies to local `bun run dev` only.

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

## Login throttling

Failed logins have fixed 15-minute windows: 5 attempts per normalized username
and 30 per client IP, including pending password checks. Further attempts return
`429` with `Retry-After` in seconds and the same response for unknown accounts.
Rejected requests do not extend the window. A successful login clears only the
username's failures, preserving the address's protection against password sprays.

Next.js Request does not expose the socket peer. By default the app ignores all
forwarding headers and applies only the per-username limit; there is no
address limit for unidentified clients, because one shared bucket would let a
single caller lock every account out. This also applies to missing or invalid
trusted headers. Without proxy trust, password sprays across many usernames are
therefore bounded only per username; enable proxy trust to add the per-IP limit.

Login and admin API JSON bodies are capped at 16 KiB (declared
`Content-Length` and streamed bytes); larger requests get `413
payload_too_large` before parsing.

Set runtime `PALETTE_LOGIN_TRUST_PROXY=true` (also passed through Compose) only
when direct client access to the app is blocked and your trusted HTTPS proxy
**overwrites** `X-Forwarded-For` with exactly one client IP. For nginx use
`proxy_set_header X-Forwarded-For $remote_addr;` rather than appending the incoming
header. Lists are rejected; `X-Real-IP` is ignored. Recreate the app container
with `compose up -d` after changing the setting.

The limiter keeps at most 10,000 username/address entries per process, reclaims
expired entries on requests, and rejects new entries temporarily at capacity
rather than evicting active protection. State resets on restart and is not shared
between processes. Run one app process as intended by ADR 0009; multiple replicas
need a shared limiter or additional proxy protection. No database migration is
required. See the [ADR 0008 addendum](adr/0008-https-authentication.md).
