# Version conflicts instead of silent overwrites

Writes and deletes atomically check the expected record version. On a conflict the server responds with 409 and the client keeps the unsaved draft, so that concurrent editing does not lead to silent overwrites.

The conflict view shows the user's own draft on the left and the current server state on the right, with the differences highlighted. Initially, complete plan states are compared and selected; alternatively, the user's own draft can be saved as a copy. Before saving, the current server version is checked again. Field-by-field merging is a possible later extension, because independently combined package dimensions and placements can produce a contradictory plan; automatic overwriting or merging is ruled out.

Amended by [ADR 0011](0011-server-record-tombstones.md): server deletes now
retain tombstones, so recreating the same store/id advances its version instead
of restarting at 1. The former same-ID recreation limitation is resolved.
Reads still treat deleted records as missing.

[ADR 0010](0010-browser-local-plans.md) continues to compare synchronization links
using both the accepted version and content hash. A confirmed deleted publication
still receives a new identity when explicitly republished as a new plan (including
an already published copy; commit `88a5971`), as required by its explicit
publication workflow.
