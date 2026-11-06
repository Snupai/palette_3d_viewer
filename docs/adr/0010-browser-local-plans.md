# Browser-local plans in server mode with explicit synchronization

Status: accepted. Partially supersedes [ADR 0002](0002-explicit-storage-mode.md)
and amends [ADR 0007](0007-explicit-local-import.md). Publication and permissions
remain governed by [ADR 0003](0003-public-project-reading.md), conflicts by
[ADR 0006](0006-optimistic-concurrency.md). Foundation for #66–#71, tracked in #72.
This ADR records the target behaviour; #65 changes documentation and comments only.

Anonymous users need to prepare plans before they have an account or sign in.
We allow explicitly browser-local work in server mode, with publication only by
consented synchronization after sign-in. A plan's storage origin stays explicit:
server failures must never turn server plans into local plans.

## Storage and access boundaries

- Only builds with `NEXT_PUBLIC_PALETTE_STORAGE_MODE=server` offer this workflow.
  Local mode and its existing inventory and import behaviour are unchanged.
- Users who have never signed in, or have deliberately signed out, may create,
  import `.rob` files into, edit, duplicate and delete Browserpläne (browser-local
  plans). These plans live only in this browser's IndexedDB and survive reloads;
  none of these actions writes to the server. Anonymous server plans remain
  read-only; duplicating one creates a distinct Browserplan with a new identity.
- Browserpläne use a dedicated database/namespace per browser origin, separate
  from legacy local-mode data (`pallets-db`) and server draft backups. The legacy
  import must not discover them as local-mode originals. Each plan records its
  browser-local origin and creation time.
- An expired, lost or unverifiable session is not a deliberate sign-out. It
  retains ADR 0002's read-only server draft, pending-save indication, draft backup
  and sign-in prompt, including across reloads. An unreachable server likewise
  never enables a storage fallback. Saves of a server plan always target that
  server; they must never be rerouted into IndexedDB. Only an explicit sign-out
  (with the existing unsaved-draft warning and backup cleanup) enables anonymous
  browser-local editing again.
- The Werkskatalog (`project-resources`) stays anonymously readable and admin-only
  for writes. Anonymous users cannot create a local catalog or catalog edits for
  later synchronization. Plans retain their embedded gripper/station definitions;
  synchronizing a plan does not publish those as catalog entries. Non-admins
  cannot synchronize catalog changes.

## Publication and conflict choices

After sign-in, a popup offers the remaining Browserpläne for synchronization.
It lists the plans and requires explicit selection and publication consent before
uploading anything. Consent states that the selected plans become anonymously
readable, searchable and exportable on this server, including file/product names
and original `.rob` text (`source.rawRobText` / `originalRawText`). The original
text is published verbatim. Signing in, dismissing the popup or comparing plans
is not consent. Declining synchronization leaves plans local and untouched; they
remain available for a later explicit attempt.

Synchronization uses the prior server link, version and content hash to distinguish
new plans, unchanged plans, local-only changes, server-only changes, both-changed
conflicts and deleted server records. Unchanged plans need no write. A local-only
update requires consent, write permission and the expected server version;
a server-only change adopts the server state. A both-changed plan requires the
user's whole-plan choice: keep server, replace with local (only with write
permission), save local as a new copy, or postpone. No field merge or silent
overwrite is allowed. A 409 requires a refreshed comparison and a new decision.
A colliding ID belonging to another user allows keep-server or a new copy, not
replacement by a non-owner; admin permissions remain as in ADR 0003. Copy identity
and retries are scoped to server and user so another user's attempt cannot reuse
an earlier user's copy by accident.

## Retention, retries and deletion

After each confirmed per-plan success, remove the local plan payload and retain a
link keyed by `{server, userId, localId}` with `{serverId, syncedVersion,
syncedContentHash, syncedAt}`. The version/hash describe the accepted server state.
This link is synchronization metadata, not another editable anonymous plan. Opening
it reads the server plan with normal server permissions and save routing. The same
rule applies to an explicit **keep server version** choice: link to the accepted
server state and remove the rejected local payload, so it does not reappear as a
conflict at every sign-in. Do not remove a newer local edit made while the sync
was running; retain it as pending against the confirmed version/hash.

Apply cleanup only after confirmation and persist it safely. A failed or ambiguous
upload keeps the local payload and pending decision; a retry must reconcile the
previous result without creating duplicates or silently overwriting. In particular,
a server success followed by a lost response or failed local cleanup is safe to
retry. Successfully completed plans stay completed if a later plan fails. Stop
uploads on network failure or session loss; keep remaining plans and postponed
conflicts for a later explicit attempt. Declined or postponed plans are neither
removed nor marked synchronized.

Deleting an unsynchronized Browserplan deletes only its local data. Removing a
local link also never deletes the server record. If a linked server plan has been
deleted, surface that fact explicitly; do not silently recreate it. The user may
discard the stale link or explicitly publish a retained local draft as a new plan,
with a new identity and publication consent. Without a retained draft there is no
local payload to republish. Connection or permission errors must not be treated
as proof of deletion.

## Shared browsers and ownership

Unsynchronized Browserpläne belong to the browser inventory, not to an account.
Anyone using that browser can see them, including the next person who signs in.
The first signed-in user who explicitly synchronizes a new plan becomes its server
creator. Keeping an existing server plan preserves its creator and permissions;
creating a separate copy assigns the current user as the copy's creator.

After success, only the matching server/user sees the link in their synchronization
state. Other users and signed-out users do not see it as an unsynchronized
Browserplan and cannot claim or republish it. They can still read the published
server plan anonymously under ADR 0003. This account separation of links is not
protection against someone with access to the browser's underlying storage.

Deliberate sign-out explains: **Plans created afterwards stay in this browser and
may be published by the next person who signs in.** It does not delete untouched
Browserpläne or transfer existing server ownership. This shared-browser trade-off
is why publication is explicit and linked plans leave the anonymous inventory.

Legacy local-mode import remains the one-way publication described in ADR 0007:
its local originals are kept. Only Browserplan synchronization uses the retention
and account-scoped links above. Neither workflow is an automatic offline replica
of the server.
