/** Sign-in, sign-out and read-only hints in server mode (#34). */
export const authDe = {
  "auth.menu": "Konto",
  "auth.signIn": "Anmelden",
  "auth.signingIn": "Anmeldung …",
  "auth.signOut": "Abmelden",
  "auth.signedInAs": "Angemeldet als {username}",
  "auth.role.admin": "Admin",
  "auth.role.user": "Benutzer",
  "auth.userManagement": "Benutzerverwaltung",
  "auth.action.openUserManagement": "Benutzerverwaltung öffnen",
  "auth.field.username": "Benutzername",
  "auth.field.password": "Kennwort",
  "auth.readOnly.badge": "Nur lesen",
  "auth.readOnly.signIn":
    "Ohne Anmeldung sind alle Pläne lesbar und exportierbar. Zum Bearbeiten bitte anmelden.",
  "auth.readOnly.checking": "Die Anmeldung wird geprüft …",
  "auth.readOnly.sessionUnknown":
    "Der Anmeldestatus ist unbekannt; Bearbeiten ist gesperrt.",
  "auth.saveAsCopy": "Als Kopie speichern",
  "auth.savingCopy":
    "Die Kopie wird gespeichert; Bearbeiten ist so lange gesperrt.",
  "auth.copyHint":
    "Dieser Plan gehört einem anderen Benutzer. Änderungen werden als eigene Kopie gespeichert.",
  "auth.deleteNotAllowed":
    "Nur der Ersteller oder ein Admin kann diesen Plan löschen.",
  "auth.status.savedAsCopy": "Als Kopie gespeichert: {name}",
  "auth.confirm.signOutUnsaved":
    "Es gibt ungespeicherte Entwürfe. Beim Abmelden werden sie verworfen, auch ihre Sicherungen in diesem Browser.",
  "auth.confirm.cancel": "Abbrechen",
  "auth.confirm.discardAndSignOut": "Entwürfe verwerfen und abmelden",
  "auth.error.missingCredentials": "Bitte Benutzername und Kennwort eingeben.",
  "auth.error.invalidCredentials": "Benutzername oder Kennwort ist falsch.",
  "auth.error.generic": "Die Anmeldung ist fehlgeschlagen.",
  "auth.error.signOutFailed": "Die Abmeldung ist fehlgeschlagen.",
  "auth.error.sessionExpired":
    "Die Sitzung ist abgelaufen. Bitte erneut anmelden; die Änderungen bleiben in diesem Fenster erhalten.",
} as const;
