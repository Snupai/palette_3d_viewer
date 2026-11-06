# Version conflicts instead of silent overwrites

Writes and deletes atomically check the expected record version. On a conflict the server responds with 409 and the client keeps the unsaved draft, so that concurrent editing does not lead to silent overwrites.

The conflict view shows the user's own draft on the left and the current server state on the right, with the differences highlighted. Initially, complete plan states are compared and selected; alternatively, the user's own draft can be saved as a copy. Before saving, the current server version is checked again. Field-by-field merging is a possible later extension, because independently combined package dimensions and placements can produce a contradictory plan; automatic overwriting or merging is ruled out.
