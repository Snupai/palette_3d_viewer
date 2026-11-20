# HMI API v1

Interface between the Palettenplaner server and the MultipackParser HMIs
(Raspberry Pi, Qt6/C++) for the HMI-Abgleich. Decision and rationale:
[ADR 0013](adr/0013-hmi-abgleich.md). Terms (Fertigstand, HMI, HMI-Abgleich,
Planvorschlag) are defined in [GLOSSARY.md](../GLOSSARY.md).

This is the handoff document for the MultipackParser side. The planner side is
built in stages; the status column says what exists.

| Part                                                | Status                |
| --------------------------------------------------- | --------------------- |
| Fertigstände in the planner (`/api/finals`, UI)     | implemented (stage 1) |
| HMI registration, tokens, config file (`/admin`)    | implemented (stage 2) |
| `/api/hmi/v1/finals`, `…/rob`, `/api/hmi/v1/status` | implemented (stage 2) |
| Planvorschläge (`/api/hmi/v1/proposal…`), QR page   | planned (stage 3)     |

Until a part is implemented its contract below is the target; changes before
release are made here first.

## Principles

- **The HMI pulls.** The server never connects to an HMI. The HMI polls, keeps
  a local copy of every Fertigstand it has downloaded and keeps working from
  that copy while the planner is unreachable.
- **Only Fertigstände.** The list contains the current Fertigstand of every
  plan marked finished, for every HMI. Each one is a frozen `.rob`; it never
  changes. A new version of a plan is a new Fertigstand with a new `id`.
- **No automatic takeover.** Syncing changes only the plan list. The running
  plan changes only after the operator confirms on the HMI. The HMI must not
  switch while the robot executes a program.
- **Server mode only.** A planner in local storage mode answers every endpoint
  with 404 `server_storage_disabled`.

## Transport and security

- **HTTPS is required.** Device tokens must not cross the mesh unencrypted
  (ADR 0008). The HMI must verify the server certificate: either the planner
  uses a certificate from a CA the Pi trusts, or the factory CA certificate is
  shipped to the Pi with its configuration and added to the TLS trust store
  used by `QNetworkAccessManager` (`QSslConfiguration::addCaCertificates`).
  Never disable certificate verification. Plain `http://` is acceptable only
  for development against `localhost`.
- **Authentication:** every request sends
  `Authorization: Bearer <token>`. The token is 43 base64url characters
  (32 random bytes). The server stores only its SHA-256. A 401 carries
  `WWW-Authenticate: Bearer realm="hmi"`.
- **Errors** are JSON `{ "error": "<code>" }` with `Cache-Control: no-store`,
  except `304` and `204`, which have no body.

| Status | `error`                                 | Meaning / HMI reaction                                                                                                                     |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 401    | `unauthenticated`                       | Missing, unknown or revoked token. Stop polling the API, show "HMI nicht freigeschaltet", keep the local plans. Retry at most every 5 min. |
| 404    | `server_storage_disabled`               | Planner runs in local mode. Treat like 401.                                                                                                |
| 404    | `final_not_found`, `proposal_not_found` | The id does not exist (any more).                                                                                                          |
| 429    | `rate_limited`                          | More than 300 requests within 60 s for this token. Wait `Retry-After` seconds.                                                             |
| 5xx    | —                                       | Server problem. Back off (see polling).                                                                                                    |

## Configuration on the HMI

An admin registers the HMI in the planner (`/admin` → HMIs) and downloads its
configuration file. The token is shown only once; generating a new token
invalidates the old one. A revoked HMI gets 401 until an admin generates a
new token for it, which re-admits it with the new configuration file.
`serverUrl` is the planner address the admin enters when downloading (the
admin's own address by default).

```json
{
  "serverUrl": "https://planer.werk.local",
  "hmiId": "2f7c1c0e-4c1d-4d8e-9a57-0e5d1c9b7a10",
  "token": "q9bXo3Y2v…43 characters…"
}
```

The HMI imports it from a USB stick into `settings.json` as
`planner.serverUrl`, `planner.hmiId` and `planner.token`. `serverUrl` has no
trailing slash; all paths below are relative to it.

## Polling

- Poll `GET /api/hmi/v1/finals` every **10 s** with `If-None-Match`.
- Poll `GET /api/hmi/v1/proposal` in the same cycle.
- On network errors, 5xx or 429: wait with exponential backoff and jitter —
  10 s, 20 s, 40 s, … capped at **5 min**, each delay multiplied by a random
  factor between 0.5 and 1.5. A 429 `Retry-After` overrides the delay. A
  successful answer resets the delay to 10 s.
- The server rate-limits each token: 300 requests per fixed 60 s window.
  Normal polling (two requests per 10 s plus downloads and status reports)
  stays far below the limit; a first sync downloading many Fertigstände at
  once may hit it and then continues after `Retry-After`.

## Endpoints

### `GET /api/hmi/v1/finals`

The current Fertigstände. Also records the HMI as seen, like every
authenticated request; the planner writes that time at most every 15 s.

Request headers: `Authorization`, optionally `If-None-Match: <etag>`.

`200`:

```http
ETag: "b5d4…"
Cache-Control: no-store
Content-Type: application/json
```

```json
{
  "finals": [
    {
      "id": "8d0a6f0e-4b52-4f8f-a1f4-5b9f6f0f2c11",
      "recordId": "project-42",
      "name": "SKU 9 · P-12",
      "fileName": "line-7.rob",
      "sha256": "2ba87cd84ffc7f6f302c26707adc128a889977bd5480f745ab58aab0a4e4db3e",
      "markedAt": "2026-11-19T08:30:00.000Z"
    }
  ]
}
```

- Ordered by `name` (case-insensitive), then `id`.
- `id` identifies one immutable Fertigstand. `recordId` identifies the plan
  (project) across versions: a newly created Fertigstand of the same plan
  keeps the `recordId` and gets a new `id` (repeating an identical mark keeps
  the existing one). Use `recordId` and `id` to show "Neue Version verfügbar"
  for the running plan. `sha256` is only the checksum of the bytes; two
  Fertigstände can have the same one.
- `markedAt` is ISO 8601 UTC.
- The ETag is opaque; send it back unchanged. `304` (no body) when the list is
  unchanged.

HMI behaviour:

1. For every entry whose `id` is not stored locally, download its `.rob`.
2. Entries missing from the list are withdrawn: hide them from the plan list,
   except the running plan, which stays active until the operator switches.
3. Never delete the `.rob` of the running plan.

### `GET /api/hmi/v1/finals/{id}/rob`

The frozen `.rob` of one Fertigstand, current **or withdrawn** (so a running
plan can be reloaded after a local data loss).

`200`:

```http
Content-Type: text/plain; charset=utf-8
ETag: "<sha256>"
Content-Disposition: attachment; filename="line-7.rob"
Cache-Control: no-store
```

The body is the `.rob` exactly as marked: same bytes, same line endings
(`\r\n` stays `\r\n`). Its SHA-256 (lower-case hex over the raw bytes) equals
the list's `sha256` and the ETag. With `If-None-Match` matching: `304`.
Unknown id: `404 final_not_found`.

HMI behaviour: compute the SHA-256 of the received bytes and compare with the
list entry; on mismatch discard the download and retry in the next cycle. Then
validate it with the HMI's own `.rob` parser before storing it. Store the
bytes unchanged.

### `GET /api/hmi/v1/proposal`

The open Planvorschlag for this HMI.

`204` when there is none. `200`:

```json
{
  "proposal": {
    "id": "c3a1d7b2-0f8e-4e57-9c1a-3f2b6d5e4a90",
    "finalId": "8d0a6f0e-4b52-4f8f-a1f4-5b9f6f0f2c11",
    "name": "SKU 9 · P-12",
    "sha256": "2ba87cd8…",
    "proposedBy": "planer",
    "createdAt": "2026-11-19T08:31:12.000Z"
  }
}
```

- An HMI has at most one open proposal; a newer one replaces (supersedes) the
  older. Proposals expire after **24 h**.
- The proposed Fertigstand may be one the HMI has not downloaded yet: fetch it
  via `…/finals/{finalId}/rob` first.

HMI behaviour: show "Neuer Plan vorgeschlagen: {name} – Übernehmen?" with a
preview, but only while the robot is not executing a program (state from the
existing dashboard client). The operator accepts or rejects; report it.

### `POST /api/hmi/v1/proposal/{id}`

Reports the operator's decision. Body (`Content-Type: application/json`):

```json
{ "result": "accepted" }
```

`result` is `accepted` or `rejected`. `204` on success. `404
proposal_not_found` when the id is unknown; `409 proposal_closed` when it was
already answered, superseded or expired — the HMI then drops its dialog.
After `accepted`, the HMI also reports its new active plan via
`/api/hmi/v1/status`.

### `POST /api/hmi/v1/status`

Reports what runs on the HMI. Send after every plan change and every 60 s.
Body:

```json
{
  "activeFinalId": "8d0a6f0e-4b52-4f8f-a1f4-5b9f6f0f2c11",
  "activeSha256": "2ba87cd8…",
  "appVersion": "MultipackParser 3.4.0"
}
```

`activeFinalId` and `activeSha256` are `null` when the running plan did not
come from the planner (USB stick) or no plan is active. All three fields are
required (each may be `null`); `activeFinalId` is a UUID, `activeSha256` 64
hex characters (any case), `appVersion` a string of at most 1000 characters
(stored trimmed when that is 1–100 printable characters, otherwise not
stored). Unknown fields are ignored. `204` on success, `400 invalid_request`
for a malformed body. The planner records the active Fertigstand only when it
knows `activeFinalId` (current or withdrawn) and `activeSha256` matches its
bytes; otherwise it records "no planner plan" and still answers `204`. The
planner shows this as "läuft: Plan X" and uses it for the "online vor 5 s"
display.

## QR code on the HMI

The HMI permanently shows a QR code with the URL

```
https://<planer>/hmi/<hmiId>
```

No token, nothing secret. The page requires a normal planner sign-in, lists
the Fertigstände and sends a Planvorschlag; the takeover itself still needs
the operator's confirmation on the HMI. Show next to the code whether the HMI
is online (last successful poll) or offline.

## Planner-side API (session users, for reference)

Used by the planner UI, not by HMIs. Cookie session, JSON only.

- `GET /api/finals[?recordId=…]` — current Fertigstände `{ finals: [{ id,
recordId, recordVersion, name, fileName, sha256, markedAt }] }`. Public like
  project reads.
- `POST /api/finals` — `{ recordId, recordVersion, name, fileName, robText }`.
  `201 { final, replacedId }` for a new Fertigstand (a current one of the same
  project is withdrawn), `200` when the same text and version are already
  current. `401` without session, `403` when not allowed, `409
version_conflict { currentVersion }` when the project is not stored at
  `recordVersion` (`null`: deleted), `413 rob_too_large` above 256 KiB, `422
rob_invalid { message }` when the text does not parse as `.rob`.
- `DELETE /api/finals/{id}` — withdraws a current Fertigstand: `204`; `404
final_not_found` when unknown or already withdrawn.
- Deleting a project withdraws its Fertigstand; it is not deleted.

Admin only (`requireAdmin`: 401 without session, 403 for non-admins), JSON
bodies only:

- `GET /api/admin/hmis` — `{ hmis: [{ id, name, createdAt, revokedAt,
lastSeenAt, appVersion, activeFinal: { id, name, sha256, withdrawn } |
null }] }`, ordered by name. Never a token or its hash.
- `POST /api/admin/hmis` — `{ name }` (1–100 characters) → `201 { hmi,
token }`; `400 invalid_name`.
- `PATCH /api/admin/hmis/{id}` — `{ name }` → `200 { hmi }`.
- `POST /api/admin/hmis/{id}/revoke` — `{}` → `200 { hmi }`; idempotent.
- `POST /api/admin/hmis/{id}/token` — `{}` → `200 { hmi, token }`; the old
  token stops working and a revocation is lifted.
- Unknown id: `404 hmi_not_found`.

## Versioning

`v1` is stable once released: fields are only added, never removed or
retyped, and the HMI must ignore unknown fields. Anything incompatible goes to
`/api/hmi/v2/…`, served in parallel until every HMI is updated.
