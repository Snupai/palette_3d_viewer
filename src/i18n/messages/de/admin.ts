/** Admin screen: user management (#32). */
export const adminDe = {
  "admin.title": "Benutzerverwaltung",
  "admin.backToPlanner": "Zum Palettenplaner",
  "admin.loading": "Benutzer werden geladen …",
  "admin.state.unavailable":
    "Diese Installation speichert lokal im Browser und hat keine Benutzerkonten.",
  "admin.state.unauthenticated":
    "Bitte als Admin anmelden, um Benutzer zu verwalten.",
  "admin.state.forbidden":
    "Nur Admins dürfen Benutzer verwalten. Angemeldet als {username}.",
  "admin.state.forbiddenAnonymous": "Nur Admins dürfen Benutzer verwalten.",
  "admin.state.error": "Die Benutzer konnten nicht geladen werden.",
  "admin.retry": "Erneut laden",
  "admin.users.heading": "Benutzer",
  "admin.users.username": "Benutzername",
  "admin.users.role": "Rolle",
  "admin.users.createdAt": "Angelegt",
  "admin.users.actions": "Aktionen",
  "admin.users.you": "(Sie)",
  "admin.role.admin": "Admin",
  "admin.role.user": "Benutzer",
  "admin.create.heading": "Benutzer anlegen",
  "admin.create.submit": "Benutzer anlegen",
  "admin.create.success": "Benutzer {username} wurde angelegt.",
  "admin.field.username": "Benutzername",
  "admin.field.usernameHint": "3–64 Zeichen: a–z, 0–9, Punkt, _ oder -.",
  "admin.field.password": "Kennwort",
  "admin.field.passwordHint":
    "Mindestens 12 Zeichen, davon 5 verschiedene, ohne den Benutzernamen.",
  "admin.field.confirmation": "Kennwort wiederholen",
  "admin.field.role": "Rolle",
  "admin.reset.open": "Kennwort zurücksetzen",
  "admin.reset.heading": "Neues Kennwort für {username}",
  "admin.reset.submit": "Kennwort setzen",
  "admin.reset.cancel": "Abbrechen",
  "admin.delete.open": "Benutzer löschen",
  "admin.delete.confirm":
    "Benutzer {username} endgültig löschen? Alle Sitzungen werden beendet. Gespeicherte Pläne bleiben erhalten.",
  "admin.delete.submit": "Endgültig löschen",
  "admin.delete.cancel": "Abbrechen",
  "admin.delete.success": "Benutzer {username} wurde gelöscht.",
  "admin.error.selfDeletion": "Sie können Ihr eigenes Konto nicht löschen.",
  "admin.error.lastAdmin": "Der letzte Admin kann nicht gelöscht werden.",
  "admin.saving": "Wird gespeichert …",
  "admin.reset.success":
    "Kennwort für {username} wurde gesetzt; bestehende Sitzungen sind beendet.",
  "admin.reset.ownSessionEnded":
    "Ihr Kennwort wurde gesetzt und Ihre Sitzung beendet. Bitte neu anmelden.",
  "admin.error.usernameRequired": "Bitte einen Benutzernamen eingeben.",
  "admin.error.passwordRequired": "Bitte ein Kennwort eingeben.",
  "admin.error.passwordMismatch": "Die Kennwörter stimmen nicht überein.",
  "admin.error.usernameTaken": "Dieser Benutzername ist bereits vergeben.",
  "admin.error.invalidUsername":
    "Benutzername: 3–64 Zeichen aus a–z, 0–9, Punkt, _ oder -, am Anfang und Ende ein Buchstabe oder eine Ziffer.",
  "admin.error.userNotFound": "Diesen Benutzer gibt es nicht mehr.",
  "admin.error.weakPassword.tooShort":
    "Das Kennwort muss mindestens 12 Zeichen lang sein.",
  "admin.error.weakPassword.tooLong":
    "Das Kennwort darf höchstens 1024 Zeichen lang sein.",
  "admin.error.weakPassword.containsUsername":
    "Das Kennwort darf den Benutzernamen nicht enthalten.",
  "admin.error.weakPassword.tooFewDistinct":
    "Das Kennwort muss mindestens 5 verschiedene Zeichen enthalten.",
  "admin.error.sessionLost":
    "Ihre Anmeldung ist abgelaufen oder hat keine Admin-Rechte mehr.",
  "admin.error.generic": "Speichern fehlgeschlagen.",
} as const;
