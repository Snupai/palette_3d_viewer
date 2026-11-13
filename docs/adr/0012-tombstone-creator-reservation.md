# Reserve deleted record ids for their former creator

Status: accepted. Amends [ADR 0011](0011-server-record-tombstones.md).

ADR 0011 cleared a tombstone's creator reference, so any signed-in user could
recreate a deleted project under its old id and become its creator. Public plan
links resolve by id alone, so old bookmarks and shared links would then show
another account's robot plan as if it were the original.

Tombstones now keep `created_by`. Creation with `expectedVersion: null` revives a
tombstone only when the caller is its former creator or an admin; anyone else
receives 403 `forbidden` and nothing changes. A fresh id is unaffected. If the
former creator's account was deleted, `created_by` is already null (foreign key
`on delete set null`), so only an admin can revive that id. Version continuity,
hidden tombstones and the update/delete conflict semantics of ADR 0011 stay as
they are; no migration is needed because the column already exists.

Pre-existing tombstones whose creator was cleared under ADR 0011 can likewise
only be revived by an admin.

[ADR 0010](0010-browser-local-plans.md)'s rule that a deleted publication is
republished under a new identity is unchanged; this only closes the shortcut of
reusing someone else's deleted id.
