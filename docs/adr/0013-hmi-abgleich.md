# HMI-Abgleich: HMIs pull finished plans from the planner

Status: accepted.

## Context

Every palletizing cell has a Raspberry Pi running the MultipackParser HMI
(Qt6/C++). Until now a `.rob` reaches it on a USB stick. The planner server
(ADR 0009) already holds every plan, so the HMIs should get finished plans
from it directly. Operators carry iPhones, so whatever shortcut exists must
work on iOS. Each Pi gets a second Wi-Fi stick for a mesh: Pis without their
own uplink are relayed through neighbouring Pis to one with a factory-network
connection, so every Pi reaches the planner server with outbound HTTP(S). The
transport is irrelevant to the planner.

## Decision

- **The Pi pulls.** Each HMI periodically asks the planner for the current
  Fertigstände and downloads new or changed ones. The server never opens a
  connection to a Pi. No inbound ports on the Pi; mesh outages are bridged by
  the Pi's local copy.
- **Only Fertigstände, to every HMI.** A Fertigstand is created by a deliberate
  "Als fertig markieren" in the planner and freezes the `.rob` of exactly that
  saved project version (table `plan_finals`). Later edits do not reach the
  HMIs until the plan is marked again, which replaces the current Fertigstand.
  A project has at most one current Fertigstand (partial unique index).
  "Nicht mehr fertig" and deleting the project withdraw it; withdrawn rows are
  kept so an HMI can reload a plan it is still running. There is no
  per-line assignment yet; a later assignment table can narrow the list.
- **The client generates the `.rob`, the server checks it.** Marking sends the
  text the `.rob` download produces (`libraryRobDownload`, including the rules
  for edited imports) with the project id and version. The server accepts it
  only if the project is stored at exactly that version (else 409), the text
  parses with `robParser`, and it is at most 256 KiB; it stores the text
  unchanged (bytes and line endings) with its SHA-256. Imported raw text
  (`source.rawRobText`) is never modified.
- **No automatic takeover.** The sync changes only the HMI's plan list. The
  running plan changes only after the operator confirms on the HMI — for a new
  version of the running plan, for a withdrawn plan, and for a Planvorschlag
  sent from a phone via the HMI's QR code.
- **Device tokens.** Each HMI is registered by an admin and authenticates with
  its own random bearer token. Only the token's SHA-256 is stored, like
  session tokens (ADR 0005); a revoked token gets 401. Generating a new
  token invalidates the old one and lifts a revocation. The QR code on an HMI
  contains only the URL of its planner page, never a token; that page needs a
  normal planner sign-in.
- **Versioned API.** The HMI endpoints live under `/api/hmi/v1/…`
  ([docs/hmi-api-v1.md](../hmi-api-v1.md)) because Pis are updated
  independently of the planner. Incompatible changes get a new version.
- **Server mode only.** In local storage mode (ADR 0002) all new routes answer
  404, like the records, auth and admin routes.
- **Planvorschläge.** A signed-in user may propose a current Fertigstand to
  one HMI (table `hmi_proposals`). An HMI has at most one pending proposal
  (partial unique index); a new one supersedes it. The HMI polls it, shows it
  to its operator and reports `accepted` or `rejected`; recording the answer
  changes nothing else in the planner. A pending proposal expires after 24 h
  and is superseded when its Fertigstand is withdrawn; both are derived on
  read and persisted by the next write. The proposing side may take a
  pending proposal back (`cancelled`, an addition to the original state
  list). Proposal reads need a session too: HMI names and what runs where are
  not public like projects (ADR 0003). Without a session the QR page links to
  `/login?returnTo=…`, which returns only to same-origin paths.
- **Permission.** For now every signed-in user may mark a plan finished,
  withdraw a Fertigstand and send or take back a Planvorschlag. The rule is
  one function (`mayManageFinals`) so it can be narrowed to roles later.
- **HTTPS is required for the HMIs.** ADR 0008 applies to device tokens as it
  does to session cookies: tokens must not cross the mesh unencrypted. Each Pi
  must trust the planner's certificate — either a certificate from a CA the
  Pi already trusts, or the factory CA certificate shipped to the Pi with its
  configuration. Plain HTTP is for local development only. Certificate
  tooling is a deployment concern and not part of the planner.

## Rejected options

- **Bluetooth.** iOS supports neither Web Bluetooth nor sending files over
  Bluetooth to non-Apple devices, and iPhones must be supported.
- **Own Wi-Fi access point per Pi.** A phone would have to leave the factory
  network to join each Pi's network, and the Pi would still not reach the
  planner. Kept only as a possible later fallback for a Pi that is offline.
- **Server pushes to the Pi.** Needs inbound ports and stable addresses on
  every Pi, which the relaying mesh does not provide, and fails silently while
  a Pi is unreachable. Pulling with a local copy tolerates both.

## Consequences

- Admins register HMIs and hand each one a configuration file with server URL,
  HMI id and token; rotating a token requires updating that Pi.
- The planner needs an HTTPS deployment reachable from the mesh uplink.
- Syncing in the other direction (changes made on an HMI back into the
  planner) is out of scope.
