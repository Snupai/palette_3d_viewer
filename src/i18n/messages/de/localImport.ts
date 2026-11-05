/** Explicit import of this browser's local plans into the server (#37, ADR 0007). */
export const localImportDe = {
  "localImport.open": "Lokale Pläne übernehmen",
  "localImport.openCount": "Lokale Pläne übernehmen ({count})",
  "localImport.title": "Lokale Pläne auf den Server übernehmen",
  "localImport.intro":
    "Dieser Browser enthält Pläne aus der lokalen Speicherung. Wähle aus, welche du auf den Server übernehmen willst. Die lokalen Originale bleiben in diesem Browser erhalten.",
  "localImport.loading": "Lokale Pläne werden mit dem Server verglichen …",
  "localImport.section.projects": "Pläne",
  "localImport.section.catalog": "Werkskatalog",
  "localImport.source.legacy": "aus der alten Bibliothek",
  "localImport.catalogKind.pallet": "Palette",
  "localImport.catalogKind.gripper": "Greifer",
  "localImport.catalogKind.pallet-station": "Palettenplatz",
  "localImport.status.new": "Neu – wird mit dir als Ersteller angelegt",
  "localImport.status.unchanged": "Bereits übernommen",
  "localImport.status.copied": "Bereits als Kopie übernommen",
  "localImport.status.differs":
    "Auf dem Server abweichend – Vergleich nach dem Import",
  "localImport.status.server-unreadable":
    "Der Servereintrag ist nicht lesbar; wird nicht übernommen",
  "localImport.status.admin-only":
    "Nur Admins dürfen den Werkskatalog befüllen",
  "localImport.select": "{name} übernehmen",
  "localImport.unreadable_one":
    "1 lokaler Eintrag ist nicht lesbar und wird nicht angeboten.",
  "localImport.unreadable_other":
    "{count} lokale Einträge sind nicht lesbar und werden nicht angeboten.",
  "localImport.nothingToImport":
    "Alle lokalen Pläne sind bereits auf dem Server. Es gibt nichts zu übernehmen.",
  "localImport.confirmPublic":
    "Mir ist bewusst, dass übernommene Pläne danach auf dem Server für alle lesbar sind – auch ohne Anmeldung, einschließlich Original-.rob-Text, Dateinamen und Produktbezeichnungen.",
  "localImport.start": "{count} übernehmen",
  "localImport.running": "Wird übernommen …",
  "localImport.close": "Schließen",
  "localImport.recheck": "Erneut vergleichen",
  "localImport.result.created_one": "1 Eintrag wurde übernommen.",
  "localImport.result.created_other": "{count} Einträge wurden übernommen.",
  "localImport.result.already_one": "1 Eintrag war bereits auf dem Server.",
  "localImport.result.already_other":
    "{count} Einträge waren bereits auf dem Server.",
  "localImport.result.conflicts_one":
    "1 Plan weicht vom Serverstand ab und wartet auf deine Entscheidung.",
  "localImport.result.conflicts_other":
    "{count} Pläne weichen vom Serverstand ab und warten auf deine Entscheidung.",
  "localImport.result.failed": "{name} wurde nicht übernommen: {message}",
  "localImport.result.decide": "Abweichungen vergleichen",
  "localImport.result.aborted":
    "Der Import wurde abgebrochen. Bereits übernommene Einträge bleiben auf dem Server; ein erneuter Versuch überspringt sie.",
  "localImport.error.load":
    "Lokale Pläne konnten nicht gelesen werden: {message}",
  "localImport.error.plan":
    "Der Vergleich mit dem Server ist fehlgeschlagen: {message}",
  "localImport.error.unknown": "unbekannter Fehler",
  "localImport.outcome.kept": "{name}: Serverstand behalten.",
  "localImport.outcome.replaced":
    "{name}: Serverstand durch den lokalen Plan ersetzt.",
  "localImport.outcome.created": "{name}: auf dem Server neu angelegt.",
  "localImport.outcome.copied": "{name}: als Kopie {copy} übernommen.",
  "localImport.outcome.copyExists":
    "{name}: dieser Stand ist bereits als Kopie auf dem Server.",
  "localImport.outcome.forbidden":
    "{name}: Ersetzen ist nur dem Ersteller oder einem Admin erlaubt.",
  "localImport.outcome.postponed_one": "1 Abweichung bleibt offen.",
  "localImport.outcome.postponed_other": "{count} Abweichungen bleiben offen.",
  "localImport.catalogConflict.heading": "Abweichende Werkskatalog-Einträge",
  "localImport.catalogConflict.local": "Lokal: {name}",
  "localImport.catalogConflict.server": "Server: {name} (Version {version})",
  "localImport.catalogConflict.serverDeleted": "Auf dem Server gelöscht",
  "localImport.catalogConflict.refreshed":
    "Der Servereintrag hat sich erneut geändert – bitte erneut entscheiden.",
  "localImport.catalogCopyName": "{name} (Kopie)",
  "localImport.conflict.title": "Plan existiert bereits auf dem Server",
  "localImport.conflict.intro":
    "Unter dieser ID liegt auf dem Server ein anderer Planstand. Wähle einen vollständigen Planstand oder übernimm den lokalen Plan als Kopie mit neuer ID. Ersteller und Berechtigungen des Serverplans ändern sich nicht.",
  "localImport.conflict.serverDeleted":
    "Der Plan wurde inzwischen auf dem Server gelöscht. Du kannst den lokalen Plan neu anlegen oder als Kopie übernehmen.",
  "localImport.conflict.mineHeading": "Lokaler Plan",
  "localImport.conflict.mineCaption": "Aus diesem Browser",
  "localImport.conflict.keepMine": "Lokalen Stand übernehmen",
  "localImport.conflict.keepMineHint":
    "Ersetzt den Serverstand – nur wenn er sich nicht noch einmal geändert hat.",
  "localImport.conflict.keepMineForbidden":
    "Nur der Ersteller oder ein Admin darf diesen Plan ersetzen.",
  "localImport.conflict.keepServer": "Serverstand behalten",
  "localImport.conflict.keepServerHint":
    "Nichts wird übernommen; der lokale Plan bleibt im Browser.",
  "localImport.conflict.keepServerDeleted": "Nicht übernehmen",
  "localImport.conflict.keepServerDeletedHint":
    "Der lokale Plan bleibt nur im Browser.",
  "localImport.conflict.saveCopy": "Als Kopie übernehmen",
  "localImport.conflict.saveCopyHint":
    "Neuer Plan mit neuer ID und dir als Ersteller; der Serverplan bleibt unverändert.",
  "localImport.conflict.later": "Später entscheiden",
  "localImport.conflict.laterHint":
    "Schließt den Vergleich; beim nächsten Import erscheint er erneut.",
} as const;
