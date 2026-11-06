# Explicit storage mode without automatic offline synchronization

The application uses either the local IndexedDB or the configured server storage. An unreachable server or an expired session does not trigger an automatic switch to local storage, because that would create diverging data sets. In the server variant, the current draft is kept in the browser when such errors occur and pending saves are shown visibly; offline synchronization is excluded for the first version.

Unsaved server drafts are additionally backed up locally, separated by server, user and project. After signing in again, restoring them is offered; after a successful save, the corresponding backup is removed. These backups are not automatic synchronization and are not part of importing the existing local plan inventory.

On a deliberate sign-out, the local draft backups of the signed-out user for this server are removed. If there are unsaved changes, a warning is shown first; the choices are "Abbrechen" ("Cancel") and "Entwürfe verwerfen und abmelden" ("Discard drafts and sign out"). A mere session expiry, by contrast, does not remove the backups.
