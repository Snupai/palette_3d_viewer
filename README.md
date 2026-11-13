# Pallet 3D Viewer

Import, inspect, and edit `.rob` pallet plans in the browser.

## Features

- Create, validate, persist, duplicate, filter, and portably export planner projects
- Deterministic row/block/edge/mixed layer solver in a cancellable Web Worker
- Accessible candidate browser with count filters, diagnostics, SVG thumbnails,
  keyboard navigation, and immediate Three.js preview
- Compose editable stacks with two patterns, transforms, special top layers,
  variable interlayers, capacity, utilization, weight, and boundary warnings
- Pattern, order, and flow editing with shared undo/redo, multi-selection, labels,
  grip groups, dependency-aware sequencing, and canonical RobotCycle inspection
- Gripper/station resources, reach/envelope/collision diagnostics, validated
  project-derived `.rob` export, deterministic simulation, and printable reports
- Safe portable project/resource packages
- Import existing `.rob` files as planner projects; migrate the old local library
  into projects while retaining original source text
- Local accounts and sign-in, with user creation and password resets at `/admin`
- PostgreSQL records with optimistic concurrency and explicit local-data import
- Anonymous Browserpläne in server mode, with consent-based post-login
  synchronization and whole-plan conflict resolution

## Roadmap

The prioritized path from the current `.rob` viewer/editor to a complete
pallet planner is documented in [ROADMAP.md](ROADMAP.md). M9 delivers the LAN
backend (PostgreSQL via Docker/Podman Compose and local user accounts); ADR 0010
adds anonymous browser-local plans and explicit synchronization after sign-in.
Browser-local IndexedDB storage stays the default build mode.
Decisions for that backend are recorded as ADRs in [docs/adr/](docs/adr/);
domain terms are defined in [GLOSSARY.md](GLOSSARY.md).
The evolving reference-case scorecard is documented in
[docs/PARITY.md](docs/PARITY.md).
The versioned planning domain and its `.rob` compatibility mapping are
documented in [docs/PROJECT_MODEL.md](docs/PROJECT_MODEL.md). Candidate identity
and geometric equality are specified in
[docs/CANDIDATE_IDENTITY.md](docs/CANDIDATE_IDENTITY.md).

## Requirements

This project uses [Bun](https://bun.sh/) as its package manager. The pinned
version is `bun@1.3.14`, as declared by the `packageManager` field in
`package.json`.

## Development

```sh
bun install
bun run dev
```

Open `http://localhost:3000`. Create a planner project or import an existing
`.rob` file inside the planner.

Available verification commands:

```sh
bun run test:run
bun run typecheck
bun run check                 # lint + typecheck
bun run lint
bun run lint:fix              # apply lint fixes
bun run format:write          # format source and docs
bun run format:check
bun run build
bun run preview               # build and start the production server
```

## External `.rob` corpus parity

The optional corpus harness reads an external directory only when
`ROB_CORPUS_DIR` is set to an absolute local directory. It does not copy source
text into the repository. Generated JSON reports are written outside the
repository, to the absolute directory in `ROB_CORPUS_REPORT_DIR` or, by default,
to `palette-rob-corpus-reports` in the system temp directory. Reports retain file basenames, byte and
semantic digests, structured evidence, and aggregate package/pallet families;
they do not retain the configured root or any absolute source path.

```sh
ROB_CORPUS_DIR="<absolute-local-directory>" bun run corpus:rob
ROB_CORPUS_DIR="<absolute-local-directory>" bun run test:corpus
ROB_CORPUS_DIR="<absolute-local-directory>" bun run corpus:rob:sentinel
```

`corpus:rob` writes a local report and exits nonzero when a `FAIL` check is
recorded. `test:corpus` exercises the configured external corpus without
writing a report. When `ROB_CORPUS_DIR` is unset, the external Vitest case is
skipped cleanly, including during the normal test suite. `corpus:rob:sentinel`
prints an anonymized, hash-only manifest and solver summary; execution failures
make it exit nonzero.

The named solver scenarios are conservative: `nominal-strict-v1` uses encoded
pallet dimensions, zero clearance, and no policy overhang;
`observed-envelope-v1` uses measured source extents as an observation only and
never converts them into allowed-overhang policy. Source grip/cycle metrics are
reported separately as observed and generated robotics parity remains blocked
until group planning is available.

## Sheet-photo extraction deployment

`POST /api/sheet-extraction` sends an uploaded pallet-sheet photo to a local
vision-model server. The route has **no authentication and no per-caller rate
limit** by design: it is meant for the local line network only. In-process
guards bound each request (20 MB upload, upload timeout, 4 concurrent uploads,
`SHEET_EXTRACTION_MAX_CONCURRENT` inferences, 5-minute model timeout, at most
two model calls), but any caller that can reach the route can keep the
inference slot busy.

Model server settings (all optional; empty counts as unset):

| Variable                          | Meaning                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHEET_EXTRACTION_API`            | `ollama` (default, `/api/chat`) or `openai` (OpenAI-compatible `/v1/chat/completions`, e.g. llama.cpp `llama-server` started with `--mmproj`)                    |
| `SHEET_EXTRACTION_URL`            | Base URL; default `http://127.0.0.1:11434` (`ollama`) or `:8080` (`openai`). The older `OLLAMA_URL` is used when this is unset.                                  |
| `SHEET_EXTRACTION_MODEL`          | Model name; Ollama defaults to `qwen2.5vl:32b`, `openai` omits it so a single-model `llama-server -m …` uses its loaded model (router/multi-model mode needs it) |
| `SHEET_EXTRACTION_MAX_CONCURRENT` | Maximum concurrent inferences per app process (positive integer, default `1`); excess requests receive 429                                                       |
| `SHEET_EXTRACTION_API_KEY`        | Sent as `Authorization: Bearer <key>` (`llama-server --api-key`); never logged                                                                                   |

The choice is explicit: there is no probing or fallback between servers.

Deployment requirements:

- Expose the app only on the trusted plant network, or behind a reverse proxy
  that authenticates users and rate-limits `/api/sheet-extraction` per user.
- Keep `SHEET_EXTRACTION_URL` on loopback or the same trusted network; photos
  contain customer data and are sent to that endpoint.
- Clients receive fixed error messages only; model URL and backend details are
  written to the server log.

To deploy without AI, build with `NEXT_PUBLIC_DISABLE_AI_FEATURES=true`: the
photo import disappears from the project forms and the route answers 404
without contacting the model server. The value is inlined at build time, so set it for
`next build`, not only at runtime.

`bun run sheet:eval` scores the extractor against a labelled photo folder
(`SHEET_CORPUS_DIR`). It accepts only plain, regular files directly inside that
folder and writes its report there without following links.

## Storage mode

The primary storage mode is chosen at build time (ADR 0002, amended by
[ADR 0010](docs/adr/0010-browser-local-plans.md)):

- `NEXT_PUBLIC_PALETTE_STORAGE_MODE=local` (default) keeps plans and resources
  in the browser's IndexedDB (`pallets-db`).
- `NEXT_PUBLIC_PALETTE_STORAGE_MODE=server` uses the LAN server backed by
  PostgreSQL at `DATABASE_URL` (ADR 0009). Server plans and the Werkskatalog
  are anonymously readable through `/api/records`; server writes require
  sign-in and permission. A stale write is rejected as a version conflict
  (ADR 0006). Missing sessions, refused writes and unreachable servers produce
  typed `ServerStorageError` errors.

In server mode, anonymous users can also create, import, edit, duplicate and
remove Browserpläne in the separate `pallets-db:browser` IndexedDB. These plans
stay in this browser until explicitly published. After sign-in, a synchronization
popup asks users to select plans and consent to publication. Conflicts offer
keep server, replace with local (when permitted), save as a new copy, or postpone.
Declining or postponing leaves the plans local. After confirmed synchronization,
the accepted local payload is removed and a link scoped to the server and account
is retained; a newer local edit made during synchronization stays pending.

Published plans become anonymously readable, searchable and exportable, including
file/product names and verbatim original `.rob` text. Unsynchronized Browserpläne
belong to the browser inventory, not an account: on a shared browser, the next
person to sign in can publish plans left by someone else. Deliberate sign-out
does not delete those plans. Keep sensitive work off shared browser profiles.

The separate explicit local import publishes legacy local-mode data only after
selection and consent, and keeps the local originals (ADR 0007). It does not
import Browserpläne. Neither workflow is an automatic offline replica. An
unreachable server or expired session never reroutes server-plan saves into
IndexedDB. `createPlannerRecordStorage()` selects the primary storage;
`createBrowserLocalPlannerStorage()` explicitly constructs the anonymous browser
inventory, both in `src/lib/plannerStorageFactory.ts`.

### Running the full stack in containers

Step-by-step instructions for both engines, configuration, updates and recovery:
[Deployment with Docker or Podman](docs/DEPLOYMENT.md).

One command starts PostgreSQL, applies the migrations (one-shot `migrate`
service) and then the app, built from the multi-stage `Dockerfile` (Next.js
standalone output, non-root runtime). Works with Docker Compose and Podman
(`CONTAINER_ENGINE=podman` switches the scripts):

```sh
bun run stack:up              # docker compose up -d --build → http://127.0.0.1:3000
bun run stack:down            # stop everything; data stays in the volume
```

All ports are bound to `127.0.0.1` (`PALETTE_APP_PORT`, `PALETTE_DB_PORT`);
LAN exposure needs HTTPS first (ADR 0008). `PALETTE_DB_PASSWORD` is required
(Compose refuses to start without it, so there is no known default password); it goes verbatim into `DATABASE_URL`, so keep it URL-safe
(`A-Z a-z 0-9 - . _ ~`). The storage mode is a build arg and
defaults to `local`; rebuild with
`PALETTE_STORAGE_MODE=server bun run stack:up` to store plans on the server. The
`SHEET_EXTRACTION_*` settings (and `OLLAMA_URL`) are passed through to the app
container; use `host.docker.internal` / `host.containers.internal` for a model
server on the host, e.g. `SHEET_EXTRACTION_API=openai`,
`SHEET_EXTRACTION_URL=http://host.docker.internal:8080` and
`SHEET_EXTRACTION_API_KEY=…` for llama.cpp.

### Backups and restore

The stack includes a `backup` service (ADR 0009, issue #38): every hour it
runs `pg_dump -Fc` against `db` and writes
`palette-YYYYMMDDTHHMMSSZ.dump` (UTC) into `PALETTE_BACKUP_DIR` (default
`./backups`, git-ignored). `pg_dump` takes one consistent snapshot while the
app keeps running, so at most one hour of changes can be lost. **Point
`PALETTE_BACKUP_DIR` at a separate disk** so a dead data disk does not take
the backups with it. A dump is written to its own hidden temporary file, checked
with `pg_restore --list` and only then renamed, so every `palette-*.dump` is
complete, also when a manual `db:backup` overlaps the hourly run. Dumps older than 7 days are deleted, but only after a successful
dump. Dumps contain password hashes; they are created owner-only (`0600`).

```sh
PALETTE_BACKUP_DIR=/mnt/backup/palette bun run stack:up   # creates the directory
bun run db:backup                     # one extra dump now
docker compose ps backup              # "healthy" = a dump from the last ~2 hours
docker compose logs backup            # wrote / pruned / FAILED lines
```

Settings: `PALETTE_BACKUP_INTERVAL_SECONDS` (default `3600`),
`PALETTE_BACKUP_RETENTION_DAYS` (default `7`), `PALETTE_BACKUP_USER`
(`uid:gid` that owns the files; the default root is your own user under
rootless Podman, with Docker on Linux use e.g. `1000:1000`). Podman needs the
directory to exist before `up`; `bun run stack:up` creates it. The logic lives
in `scripts/pg-backup.sh` (POSIX sh, tested by
`src/server/db/pgBackupScript.node.test.ts`).

**Restore** replaces the whole database with the dump, in one transaction (on
any error nothing changes): every schema is dropped first, so tables from a
migration newer than the dump disappear and `migrate` re-applies them on the
next start. First use the same code version as the backup and stop both the app
and the hourly backup loop, then pass a file name
from `PALETTE_BACKUP_DIR` and `--yes`:

```sh
docker compose stop app backup
bun run db:restore palette-20261105T140000Z.dump --yes
docker compose up -d                  # migrate runs, app and backup restart
```

Without `--yes` the command only checks the file and prints the warning. On a
new machine or after losing the volume: copy the dumps into
`PALETTE_BACKUP_DIR`, run `bun run db:up` (empty database), the restore
command above, then `bun run stack:up`. `bun run db:restore …` is
`docker compose run --rm backup restore …`; with Podman set
`CONTAINER_ENGINE=podman` or use `podman compose run --rm backup restore …`.

### Admin account

There is no public sign-up (ADR 0005): the first admin is created with a local
command on the server, which asks for the password twice without echoing it
(at least 12 characters, at least 5 different ones, not containing the
username). Both commands take `--username <name>` (default `admin`).

```sh
bun run admin:init            # creates the admin; if one exists, nothing changes
bun run admin:reset-password  # new password; revokes all of that admin's sessions
```

They connect to `DATABASE_URL` (run `bun run db:migrate` first). With the
containerized stack, run them from the `migrate` image, which reaches the
database on the compose network:

```sh
docker compose run --rm migrate node admin.mjs init
docker compose run --rm migrate node admin.mjs reset-password --username admin
```

(`podman compose` works the same.) Piped stdin is read one password per line,
e.g. for provisioning scripts.

After initialization, sign in and open `/admin` to create further users and
reset their passwords or delete accounts after confirmation. Both reset and deletion
revoke all of that user's sessions. Deletion retains saved plans and clears their
creator association; admins can still manage those plans. Admins cannot delete
their own account or the last admin. There is no public
registration. The admin-only API exposes `GET /api/admin/users` (list),
`POST /api/admin/users` (create), `POST /api/admin/users/[id]/password`
(reset), and `DELETE /api/admin/users/[id]` (delete). Authentication uses `POST /api/auth/login`, `POST /api/auth/logout`
and `GET /api/auth/me`.

Sessions last 12 hours. The `palette_session` cookie is `HttpOnly`, `SameSite=Lax`
and always `Secure`, except in development on `localhost` or a loopback address.
Production containers and `bun run start` / `bun run preview` therefore require
HTTPS for sign-in, including on localhost; plain HTTP is for local `bun run dev`
only. See [deployment access setup](docs/DEPLOYMENT.md#access-on-the-plant-network).

Failed logins are limited to 5 per normalized username and 30 per client address
within 15 minutes, with temporary `429` / `Retry-After` responses. Successful
login clears the username counter. See [deployment configuration](docs/DEPLOYMENT.md#login-throttling)
for proxy trust, unidentified clients and process-local limits.

### Database only (development)

`compose.yaml` starts PostgreSQL 17 (`docker.io/library/postgres:17`) with a
named volume, bound to `127.0.0.1:5432` only. For `bun run dev` start just the
database:

```sh
cp .env.example .env          # set PALETTE_DB_PASSWORD and DATABASE_URL with the same password
# Also set NEXT_PUBLIC_PALETTE_STORAGE_MODE=server in .env; DATABASE_URL alone is ignored.
bun run db:up                 # docker compose up -d db
bun run db:migrate            # apply drizzle/ migrations to DATABASE_URL
bun run dev                   # server mode, with development HTTP on loopback
bun run db:down               # stop; data stays in the volume
```

After editing the schema in `src/server/db/schema/`, run `bun run db:generate`
to write the next migration into `drizzle/`. Tests never need the container:
server tests run against PGlite with the same migrations.

## Supported `.rob` invariants

- Blank lines are positionally significant and are preserved while parsing.
- Package coordinates are integers.
- Supported package rotations are `0`, `90`, `180`, and `270` degrees.
- Each `Zwischenlage` contributes 3 mm to the stack height.
- Imported raw text is retained so plans can be parsed again and round-tripped
  without discarding source formatting.

## Stack

Next.js 15 App Router, React 19, Three.js, Tailwind CSS 4, TypeScript, and
Vitest.

## License

[MIT](LICENSE)
