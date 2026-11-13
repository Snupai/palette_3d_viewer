# Create the admin during initialization

The server installation receives an admin with a secure password during initialization. Public first-time registration following the principle "the first user becomes admin" is dropped, so that administrative access does not depend on the first visitor of the installation. Further users are created by the admin.

Initialization and recovery of admin access are done through a local administration command on the server with hidden password input. Repeated initialization leaves an existing admin unchanged. An explicit reset sets a new password and revokes that admin's existing sessions.

The first version uses local user accounts. A later sign-in with Windows/domain or Microsoft 365 accounts is an open extension and not a prerequisite for the first version. The existing company identity infrastructure is still unknown; the sign-in method, mapping of external identities and admission of company users will be decided only after this has been clarified.

Implementation note: with the container stack, run
`docker compose run --rm migrate node admin.mjs init` for initialization or
`docker compose run --rm migrate node admin.mjs reset-password` for recovery
(`podman compose` works the same). The `migrate` image bundles `admin.mjs` and
connects to the database on the Compose network. After sign-in, admins can create
further users and reset passwords at `/admin`; see the
[README](../../README.md#admin-account).

## Addendum: account deletion (#86)

Admins can permanently delete other local accounts through
`DELETE /api/admin/users/[id]` and a confirmation at `/admin`. Deleting one's
own account or the last admin is rejected (409 `self_deletion` /
`last_admin`); unknown accounts return 404 `user_not_found`. Deletions lock
admin rows in ID order and recheck the acting admin inside the transaction, so
concurrent requests cannot remove all admins or act as an already deleted admin.
Account creation and password resets through the admin API take the same lock
and recheck inside their transaction; a request whose admin was deleted
meanwhile commits nothing and answers 403 `forbidden`.

The local account model is unchanged: there is no disabled-account state.
Existing foreign keys revoke all sessions (`ON DELETE CASCADE`) and retain
planner records with `created_by = NULL` (`ON DELETE SET NULL`); content,
versions and public read access remain intact. Admins retain write access to
these records; ordinary users do not inherit ownership. No migration is needed.
