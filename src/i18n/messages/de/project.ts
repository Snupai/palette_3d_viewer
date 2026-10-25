/** Namespace `project` — German source strings. */
export const projectDe = {
  // Tool titles
  "project.tool.candidateBrowser": "Kandidaten-Browser",
  "project.tool.candidate3d": "3D-Prüfung der Kandidaten",
  "project.tool.stack": "Stapel-Editor",
  "project.tool.editor": "Muster-Editor",
  "project.tool.robotics": "Robotik & Greifer",
  "project.tool.simulation": "Simulation",
  "project.tool.report": "Palettierblatt",
  "project.tool.fallback": "Werkzeug",
  // Labels
  "project.untitledPlan": "Unbenannter Plan",
  "project.geometryReview":
    "Maße oder Handhabung wurden geändert. Gespeicherte Lösungen bleiben erhalten, müssen aber vor Robotik und Export neu aufgebaut und geprüft werden.",
  // Errors and status messages
  "project.error.libraryFailed": "Projektbibliothek fehlgeschlagen: {message}",
  "project.error.libraryFailedGeneric": "Projektbibliothek fehlgeschlagen.",
  "project.status.legacyImported_one":
    "{count} Eintrag der alten .rob-Bibliothek wurde als nicht-destruktives Planer-Projekt übernommen.",
  "project.status.legacyImported_other":
    "{count} Einträge der alten .rob-Bibliothek wurden als nicht-destruktive Planer-Projekte übernommen.",
  "project.error.migrationFailed":
    "Migration der alten Bibliothek fehlgeschlagen: {message}",
  "project.error.migrationFailedGeneric":
    "Migration der alten Bibliothek fehlgeschlagen.",
  "project.error.reopenMissing":
    "Projekt „{id}“ konnte nicht erneut geöffnet werden.",
  "project.error.reopenFailed":
    "Projekt erneut öffnen fehlgeschlagen: {message}",
  "project.error.reopenFailedGeneric": "Projekt erneut öffnen fehlgeschlagen.",
  "project.status.planSaved": "Plan „{name}“ gespeichert.",
  "project.status.duplicated": "Projekt dupliziert als „{name}“.",
  "project.error.sourceMissing": "Das Quellprojekt fehlt.",
  "project.error.duplicateFailed": "Duplizieren fehlgeschlagen: {message}",
  "project.error.duplicateFailedGeneric": "Duplizieren fehlgeschlagen.",
  "project.status.savedAs": "Projekt gespeichert als „{name}“.",
  "project.error.saveAsFailed": "Speichern unter fehlgeschlagen: {message}",
  "project.error.saveAsFailedGeneric": "Speichern unter fehlgeschlagen.",
  "project.error.projectGone": "Das Projekt existiert nicht mehr.",
  "project.status.deleted": "Projekt „{name}“ gelöscht.",
  "project.error.deleteFailed": "Löschen fehlgeschlagen: {message}",
  "project.error.deleteFailedGeneric": "Löschen fehlgeschlagen.",
  "project.error.robDownloadFailed": ".rob-Download fehlgeschlagen: {message}",
  "project.status.downloaded": "{fileName} heruntergeladen.",
  "project.fallbackName": "Projekt",
  "project.status.exportedSelected":
    "Ausgewähltes Projekt und wiederverwendbare Ressourcenbibliothek exportiert.",
  "project.status.exportedAll":
    "Projekt- und Ressourcenbibliotheken exportiert.",
  "project.error.exportFailed": "Export fehlgeschlagen: {message}",
  "project.error.exportFailedGeneric": "Export fehlgeschlagen.",
  "project.status.imported":
    "{projects} Projekt(e) und {resources} Ressource(n) importiert; {skippedProjects} Projekt(e) und {skippedResources} Ressource(n) übersprungen.",
  "project.error.importFailed": "Import fehlgeschlagen: {message}",
  "project.error.importFailedGeneric": "Import fehlgeschlagen.",
  "project.status.robOpened": "„{name}“ als aktuellen Plan geöffnet.",
  "project.error.robImportFailed": ".rob-Import fehlgeschlagen: {message}",
  "project.error.robImportFailedGeneric": ".rob-Import fehlgeschlagen.",
  "project.error.projectRequired":
    "Vor der Generierung ist ein aktuelles Projekt erforderlich.",
  "project.error.editorDirtyBeforeInputs":
    "Speichern oder verwerfen Sie die Projekteditor-Änderungen, bevor Generator-Eingaben angewendet werden.",
  "project.status.generatorInputsApplied":
    "Generator-Paketeingaben übernommen: {length} × {width} × {height} mm · Zufuhr {orientation} von links nach rechts · automatische Mehrfachgreifer-Gruppierung {multipick}.",
  "project.enabled": "aktiviert",
  "project.disabled": "deaktiviert",
  "project.error.editorDirtyBeforeStack":
    "Speichern oder verwerfen Sie die Projekteditor-Änderungen, bevor der aktive Lösungsstapel ersetzt wird.",
  "project.confirm.replaceStack":
    "Gespeicherten Stapel ({existing} Lagen) durch den aktuellen Entwurf ({draft} Lagen) ersetzen?",
  "project.status.stackSaved":
    "Stapel gespeichert: {packages} Pakete auf {layers} Lagen.",
  // Confirms and prompts
  "project.confirm.discardUnsaved":
    "{action}: Ungespeicherte Änderungen verwerfen?",
  "project.confirm.discardInTool":
    "{action}: Ungespeicherte Änderungen in „{tool}“ verwerfen?",
  "project.action.switchProjects": "Projekt wechseln",
  "project.action.openTool": "{tool} öffnen",
  "project.action.close": "Schließen",
  "project.action.duplicate": "Dieses Projekt duplizieren",
  "project.action.saveAs": "Dieses Projekt als Kopie speichern",
  "project.action.openRob": "Die .rob-Datei als Projekt öffnen",
  "project.action.createPlan": "Neuen Plan erstellen",
  "project.action.openPlanList": "Planliste öffnen",
  "project.action.openHome": "Startseite öffnen",
  "project.copySuffix": "{number} Kopie",
  "project.copy": "Kopie",
  "project.newLine": "Neue Linie",
  "project.prompt.lineNumber": "Liniennummer für die neue Kopie",
  "project.prompt.productNumber": "Produktnummer für die neue Kopie",
  "project.confirm.deleteOpen":
    "„{name}“ löschen und ungespeicherte Planer-Änderungen verwerfen?",
  "project.confirm.changePattern":
    "Anderes Muster wählen: Ungespeicherte Stapeländerungen gehen verloren, wenn Sie ein anderes Muster auswählen. Fortfahren?",
  "project.confirm.closeInputs":
    "Eingaben schließen: Ungespeicherte Eingaben verwerfen?",
  "project.confirm.changedDimensions":
    "Geänderte Maße: Ungespeicherte Stapel- und Editoränderungen verwerfen?",
  // Steps
  "project.steps.label": "Planungsschritte",
  "project.steps.packagePallet": "Paket & Palette",
  "project.steps.pickPattern": "Muster auswählen",
  "project.steps.buildStack": "Stapel aufbauen",
  // Validation ledger
  "project.ledger.importedPlan": "Importierter Plan",
  "project.ledger.importedClaim":
    "Die aktuelle Geometrie stammt aus der importierten .rob-Datei; ein zweiter Referenzplan ist nicht erforderlich.",
  "project.ledger.importedDetail": "{layers} Lagen · {packages} Pakete",
  "project.ledger.currentGeometry": "Aktuelle Geometrie",
  "project.ledger.candidatePassed":
    "Der gewählte Solver-Kandidat hat die internen Geometrieprüfungen bestanden.",
  "project.ledger.candidateFailed":
    "Der gewählte Solver-Kandidat hat die internen Geometrieprüfungen nicht bestanden.",
  "project.ledger.importedLayerShown":
    "Die importierte Lagengeometrie wird als aktueller Plan angezeigt.",
  "project.ledger.savedLayerObservable":
    "Eine gespeicherte aktuelle Lage ist einsehbar; die Solver-Validierung wurde nicht erneut ausgeführt.",
  "project.ledger.noGeometry": "Keine aktuelle Lagengeometrie verfügbar.",
  "project.ledger.candidateDetail": "Kandidat {rank} · {packages} Pakete",
  "project.ledger.robotReadiness": "Roboterbereitschaft",
  "project.ledger.robotPass":
    "Plan, Ausrüstung, Aufnahmepunkt, Stationsarbeitsraum und modellierte Hindernisse haben die verfügbaren internen Prüfungen bestanden.",
  "project.ledger.robotObservedEquipment":
    "Das beobachtete Multipack-Ausrüstungsprofil ist gewählt; die aktuellen Prüfungen belegen keine kalibrierte Produktionsreife.",
  "project.ledger.robotObserved":
    "Die Roboterprüfungen wurden mit unverifizierten oder unkalibrierten Einschränkungen abgeschlossen.",
  "project.ledger.robotSkipped":
    "Es wird keine Roboterbereitschaft zugesichert, weil mindestens eine Arbeitsraumprüfung nicht ausgeführt wurde.",
  "project.ledger.robotBlocked":
    "Schließen Sie die Prüfungen von Plan, Ausrüstung, Aufnahmepunkt und Stationsarbeitsraum ab, bevor die Roboterbereitschaft bestehen kann.",
  "project.ledger.exportReadiness": "Exportbereitschaft",
  "project.ledger.exportClaim":
    "Produktions-Koordinatenabbildung, Quantisierung und unbekannte .rob-Felder erfordern eine ausdrückliche Prüfung in der Robotik.",
  // Candidate 3D / .rob download
  "project.candidate3d.empty":
    "Wählen Sie einen generierten Kandidaten, bevor Sie die 3D-Prüfung öffnen.",
  "project.download.noRobText": "Dieses Projekt enthält keinen .rob-Dateitext.",
  "project.download.noStack":
    "Speichern Sie einen Stapel für dieses Projekt, bevor Sie einen .rob-Plan herunterladen.",
  "project.download.exportFailed":
    "Der .rob-Plan konnte nicht exportiert werden.",
  // Sheet extraction
  "project.sheet.extractionFailed":
    "Auslesen des Blatts fehlgeschlagen ({status}).",
  // Project library
  "project.library.untitled": "Unbenanntes Projekt",
  "project.library.title": "Projekte",
  "project.library.new": "Neu",
  "project.library.searchLabel": "Projekte durchsuchen",
  "project.library.searchPlaceholder": "ID, Linie, Produkt, Datei…",
  "project.library.lineFilter": "Linienfilter",
  "project.library.lineFilterLabel": "Nach Liniennummer filtern",
  "project.library.lineFilterPlaceholder": "Linien-Nr.",
  "project.library.productFilter": "Produktfilter",
  "project.library.productFilterLabel": "Nach Produktnummer filtern",
  "project.library.productFilterPlaceholder": "Produkt-Nr.",
  "project.library.sort": "Sortierung",
  "project.library.sort.updatedDesc": "Zuletzt geändert",
  "project.library.sort.updatedAsc": "Älteste Änderung",
  "project.library.sort.lineAsc": "Liniennummer A–Z",
  "project.library.sort.lineDesc": "Liniennummer Z–A",
  "project.library.sort.productAsc": "Produktnummer A–Z",
  "project.library.sort.productDesc": "Produktnummer Z–A",
  "project.library.sort.createdDesc": "Zuletzt erstellt",
  "project.library.loading": "Projekte werden geladen…",
  "project.library.empty": "Keine Projekte entsprechen der aktuellen Suche.",
  "project.library.listLabel": "Projektbibliothek",
  "project.library.noLineNumber": "Keine Liniennummer",
  "project.library.actionsFor": "Aktionen für {title}",
  "project.library.edit": "Bearbeiten",
  "project.library.duplicate": "Duplizieren",
  "project.library.saveAs": "Speichern unter",
  "project.library.export": "Exportieren",
  "project.library.downloadRob": ".rob herunterladen",
  "project.library.downloadImportedTitle":
    "Die importierte .rob-Datei herunterladen",
  "project.library.downloadDerivedTitle":
    "Den aus dem gespeicherten Stapel abgeleiteten .rob-Plan herunterladen",
  "project.library.deleteQuestion": "Projekt löschen?",
  "project.library.delete": "Löschen",
  "project.library.cancel": "Abbrechen",
  "project.library.deleteTitle": "Umschalt+Klick löscht ohne Bestätigung",
  "project.library.exportAll": "Alle Projekte exportieren",
  "project.library.projectConflict": "Projektkonflikt",
  "project.library.projectConflictLabel":
    "Konfliktrichtlinie beim Projektimport",
  "project.library.resourceConflict": "Ressourcenkonflikt",
  "project.library.resourceConflictLabel":
    "Konfliktrichtlinie beim Ressourcenimport",
  "project.library.policy.rename": "Neue umbenennen",
  "project.library.policy.skip": "Neue überspringen",
  "project.library.policy.overwrite": "Bestehende überschreiben",
  "project.library.import": "Projekt- und Ressourcenpaket importieren",
} as const;
