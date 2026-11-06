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
