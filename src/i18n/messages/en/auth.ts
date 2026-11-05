import type { authDe } from "../de/auth";

export const authEn = {
  "auth.menu": "Account",
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in …",
  "auth.signOut": "Sign out",
  "auth.signedInAs": "Signed in as {username}",
  "auth.role.admin": "Admin",
  "auth.role.user": "User",
  "auth.userManagement": "User management",
  "auth.action.openUserManagement": "Open user management",
  "auth.field.username": "Username",
  "auth.field.password": "Password",
  "auth.readOnly.badge": "Read only",
  "auth.readOnly.signIn":
    "Without signing in, all plans can be read and exported. Sign in to edit.",
  "auth.readOnly.checking": "Checking the sign-in …",
  "auth.readOnly.sessionUnknown":
    "The sign-in status is unknown; editing is locked.",
  "auth.saveAsCopy": "Save as copy",
  "auth.copyHint":
    "This plan belongs to another user. Changes are saved as your own copy.",
  "auth.deleteNotAllowed": "Only the creator or an admin can delete this plan.",
  "auth.status.savedAsCopy": "Saved as copy: {name}",
  "auth.confirm.signOutUnsaved":
    "There are unsaved changes. Discard drafts and sign out?",
  "auth.error.missingCredentials": "Please enter username and password.",
  "auth.error.invalidCredentials": "Username or password is incorrect.",
  "auth.error.generic": "Signing in failed.",
  "auth.error.signOutFailed": "Signing out failed.",
  "auth.error.sessionExpired":
    "The session has expired. Please sign in again; your changes stay in this window.",
} as const satisfies Record<keyof typeof authDe, string>;
