/** QR page `/hmi/[hmiId]`: Planvorschläge from a phone (ADR 0013). */
export const hmiDe = {
  "hmi.title": "HMI",
  "hmi.loading": "HMI wird geladen …",
  "hmi.state.unavailable":
    "Diese Installation speichert lokal im Browser und kennt keine HMIs.",
  "hmi.state.unauthenticated":
    "Bitte melden Sie sich an, um diesem HMI einen Plan vorzuschlagen.",
  "hmi.state.notFound": "Dieses HMI ist nicht registriert.",
  "hmi.state.error": "Das HMI konnte nicht geladen werden.",
  "hmi.signIn": "Anmelden",
  "hmi.retry": "Erneut laden",
  "hmi.seen": "zuletzt gesehen {when}",
  "hmi.running": "läuft: {name}",
  "hmi.running.withdrawn": "läuft: {name} (zurückgezogen)",
  "hmi.running.none": "läuft: kein Plan aus dem Planer",
  "hmi.revoked":
    "Dieses HMI ist gesperrt und holt keine Pläne ab. Vorschläge sind erst wieder möglich, wenn ein Admin einen neuen Token erzeugt.",
  "hmi.proposal.heading": "Planvorschlag",
  "hmi.proposal.by": "{name} · vorgeschlagen von {user}",
  "hmi.proposal.byUnknown": "{name}",
  "hmi.proposal.state.pending":
    "Wartet auf die Bestätigung am HMI. Gewechselt wird erst, wenn der Bediener übernimmt.",
  "hmi.proposal.state.pendingOffline":
    "Das HMI ist gerade nicht erreichbar. Der Vorschlag kommt an, sobald es wieder online ist.",
  "hmi.proposal.state.accepted": "Übernommen.",
  "hmi.proposal.state.rejected": "Am HMI abgelehnt.",
  "hmi.proposal.state.superseded":
    "Ersetzt – durch einen neueren Vorschlag oder weil der Fertigstand zurückgezogen wurde.",
  "hmi.proposal.state.expired": "Abgelaufen: 24 Stunden ohne Antwort.",
  "hmi.proposal.state.cancelled": "Zurückgenommen.",
  "hmi.proposal.cancel": "Vorschlag zurücknehmen",
  "hmi.proposal.cancelSuccess": "Der Vorschlag wurde zurückgenommen.",
  "hmi.finals.heading": "Fertigstände",
  "hmi.finals.search": "Fertigstände durchsuchen",
  "hmi.finals.loading": "Fertigstände werden geladen …",
  "hmi.finals.loadError": "Die Fertigstände konnten nicht geladen werden.",
  "hmi.finals.empty": "Noch kein Plan ist als fertig markiert.",
  "hmi.finals.noMatch": "Kein Fertigstand passt zur Suche.",
  "hmi.finals.running": "läuft hier",
  "hmi.propose.submit": "An HMI vorschlagen",
  "hmi.propose.sending": "Wird gesendet …",
  "hmi.propose.pick": "Bitte zuerst einen Fertigstand wählen.",
  "hmi.propose.hint":
    "Das HMI fragt den Bediener. Der laufende Plan wechselt erst nach seiner Bestätigung.",
  "hmi.propose.success": "Vorschlag an {hmi} gesendet.",
  "hmi.error.unauthenticated":
    "Die Anmeldung ist abgelaufen. Bitte erneut anmelden.",
  "hmi.error.forbidden": "Sie dürfen keine Pläne vorschlagen.",
  "hmi.error.finalGone":
    "Dieser Fertigstand wurde inzwischen zurückgezogen oder ersetzt.",
  "hmi.error.revoked": "Das HMI ist gesperrt.",
  "hmi.error.notFound": "Dieses HMI ist nicht registriert.",
  "hmi.error.proposalClosed":
    "Der Vorschlag ist bereits beantwortet, ersetzt oder abgelaufen.",
  "hmi.error.generic": "Das hat nicht geklappt. Bitte erneut versuchen.",
} as const;
