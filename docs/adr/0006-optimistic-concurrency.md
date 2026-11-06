# Version conflicts instead of silent overwrites

Writes and deletes atomically check the expected record version. On a conflict the server responds with 409 and the client keeps the unsaved draft, so that concurrent editing does not lead to silent overwrites.

The conflict view shows the user's own draft on the left and the current server state on the right, with the differences highlighted. Initially, complete plan states are compared and selected; alternatively, the user's own draft can be saved as a copy. Before saving, the current server version is checked again. Field-by-field merging is a possible later extension, because independently combined package dimensions and placements can produce a contradictory plan; automatic overwriting or merging is ruled out.

Known limitation: server deletes physically remove the row. Recreating a record
under the same ID therefore starts again at version 1; IndexedDB instead retains
tombstones. Version numbers alone cannot distinguish the old record from its
recreation, so they are not a durable record identity across deletion.

[ADR 0010](0010-browser-local-plans.md) compares synchronization links using both
the accepted version and content hash, but neither proves continuity of identity
if a deleted record is recreated with the same version and content. A confirmed
deleted publication must therefore receive a new identity when explicitly
republished as a new plan (including an already published copy; commit
`88a5971`). This avoids reusing the deleted publication's identity; it does not
add server tombstones or remove the same-ID recreation limitation.
