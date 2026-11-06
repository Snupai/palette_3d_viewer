# Publish local data explicitly

Existing browser data is transferred into server storage after sign-in, with a preceding overview and explicit confirmation of the publication, because imported projects are then also readable anonymously. For newly created projects, the signed-in user is recorded as the creator; local originals are kept. A retry after a connection drop must create neither duplicates nor silent overwrites. Entries that were already imported successfully and are unchanged are skipped.

When contents differ, the import uses the same conflict view as concurrent editing: local plan on the left, existing server state on the right, differences highlighted. Complete plan states are selected; individual fields are not merged. The server state can be kept, or the local state can be created as a separate copy with a new ID. The existing original may only be replaced with write permission and explicit selection of the local state; in that case, too, the expected server version is checked atomically. A renewed version conflict requires an updated comparison. An import collision changes neither the creator nor the permissions of the existing project.

Even during import, only admins may populate or modify the shared Werkskatalog.
