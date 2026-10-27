/** Namespace `candidates` — German source strings. */
export const candidatesDe = {
  // Candidate browser
  "candidates.browser.title": "Wählbare Muster",
  "candidates.browser.summary":
    "{shown} von {total} Mustern · {generated} erzeugte Kandidaten",
  "candidates.browser.exactCount": "Genaue Anzahl",
  "candidates.browser.exactCountAria": "Genaue Paketanzahl",
  "candidates.browser.maximum": "Maximum ({count})",
  "candidates.browser.resetFilters": "Filter zurücksetzen",
  "candidates.browser.listAria": "Wählbare Kandidatenmuster",
  "candidates.browser.colNr": "Nr.",
  "candidates.browser.colCount": "Anzahl",
  "candidates.browser.colGeometry": "Geometrie",
  "candidates.browser.colBlocks": "Blöcke",
  "candidates.browser.colCycles": "Zyklen",
  "candidates.browser.colLength": "Länge",
  "candidates.browser.colWidth": "Breite",
  "candidates.browser.geometryOk": "Geometrie OK",
  "candidates.browser.rejected": "Verworfen",
  "candidates.browser.blocksTitle":
    "Der Blocks-Wert der alten MultiPack-Software ist nicht verifiziert und wird nicht abgeleitet.",
  "candidates.browser.unknown": "Unbekannt",
  "candidates.browser.noMatch": "Kein Kandidat passt zu den aktuellen Filtern.",
  "candidates.browser.selectCandidate": "Kandidat auswählen",
  "candidates.browser.score": "Bewertung",
  "candidates.browser.utilization": "Auslastung",
  "candidates.browser.generators": "Generatoren",
  "candidates.browser.noneRecorded": "Keine erfasst",
  "candidates.browser.noDiagnosticsActive": "Keine aktive Kandidatendiagnose.",
  "candidates.browser.diagnosticsSummary":
    "Solver-Diagnose ({diagnostics}) und Ausschlüsse ({exclusions})",
  "candidates.browser.noDiagnostics": "Keine Diagnosen oder Ausschlüsse.",
  "candidates.browser.moreExclusions":
    "{count} weitere Ausschlüsse nicht angezeigt.",
  // Rank reasons
  "candidates.rank.packages": "Mehr Pakete je Lage ({current} statt {next})",
  "candidates.rank.utilization":
    "Höhere Flächenauslastung ({current} % statt {next} %)",
  "candidates.rank.cycles": "Weniger Roboterzyklen ({current} statt {next})",
  "candidates.rank.boundingBlock":
    "Kleinerer Begrenzungsblock ({currentLength} × {currentWidth} mm statt {nextLength} × {nextWidth} mm)",
  "candidates.rank.perimeter":
    "Kürzerer Umfang des Begrenzungsblocks ({current} mm statt {next} mm)",
  "candidates.rank.tie":
    "Gleichwertige Bewertung — durch den deterministischen Identitäts-Tiebreak vorn gereiht",
  // Package label face picker
  "candidates.picker.infeedOrientation": "Einlaufausrichtung",
  "candidates.picker.lengthwise": "Längs",
  "candidates.picker.crosswise": "Quer",
  "candidates.picker.physicalFace": "Physische Etikettenseite",
  "candidates.picker.infeedLength": "L →",
  "candidates.picker.infeedWidth": "B →",
  "candidates.picker.acrossWidth": "B ↕",
  "candidates.picker.acrossLength": "L ↕",
  "candidates.picker.edgeLabel.top": "Oben",
  "candidates.picker.edgeLabel.right": "Rechts",
  "candidates.picker.edgeLabel.bottom": "Unten",
  "candidates.picker.edgeLabel.left": "Links",
  "candidates.picker.edgeName.top": "oben",
  "candidates.picker.edgeName.right": "rechts",
  "candidates.picker.edgeName.bottom": "unten",
  "candidates.picker.edgeName.left": "links",
  "candidates.picker.physicalSide.top": "0° Fläche oben (+Y)",
  "candidates.picker.physicalSide.right": "0° Fläche rechts (+X)",
  "candidates.picker.physicalSide.bottom": "0° Fläche unten (−Y)",
  "candidates.picker.physicalSide.left": "0° Fläche links (−X)",
  "candidates.picker.selectEdge": "Etikett am angezeigten Rand {edge} wählen",
  "candidates.picker.faceTitle": "Physische Paketfläche: {face}",
  "candidates.picker.infeedDirectionAria":
    "Einlaufrichtung: von links nach rechts",
  "candidates.picker.infeed": "Einlauf",
  "candidates.picker.leftToRight": "Links → rechts",
  "candidates.picker.selectedSummary": "{face} · angezeigt am Rand {edge}",
  "candidates.picker.noPreference":
    "Keine Etikett-Präferenz für die nächste Kante",
  "candidates.picker.noLabel": "Kein Etikett",
  // Solver controls: shared labels and errors
  "candidates.solver.packageLength": "Paketlänge",
  "candidates.solver.packageWidth": "Paketbreite",
  "candidates.solver.packageHeight": "Pakethöhe",
  "candidates.solver.lengthTotal": "Über-/Unterstand Länge gesamt",
  "candidates.solver.widthTotal": "Über-/Unterstand Breite gesamt",
  "candidates.solver.packagesPerLayer": "Pakete je Lage",
  "candidates.solver.candidatesPerGenerator": "Kandidaten je Generator",
  "candidates.solver.automaticGroupLimit": "Automatisches Gruppenlimit",
  "candidates.solver.error.positive":
    "{label} muss eine endliche positive Zahl sein.",
  "candidates.solver.error.required": "{label} ist erforderlich.",
  "candidates.solver.error.finite": "{label} muss eine endliche Zahl sein.",
  "candidates.solver.error.integer":
    "{label} muss eine positive ganze Zahl sein.",
  "candidates.solver.error.palletRequired":
    "Vor der Erzeugung ist eine Palette erforderlich.",
  "candidates.solver.error.prepare":
    "Solver-Eingaben konnten nicht vorbereitet werden.",
  "candidates.solver.error.applyFailed":
    "Aktualisierung der Paketeingaben fehlgeschlagen: {message}",
  "candidates.solver.error.applyFailedUnknown":
    "Aktualisierung der Paketeingaben fehlgeschlagen.",
  "candidates.solver.error.appliedInvalid":
    "Die übernommenen Generator-Eingaben sind ungültig.",
  "candidates.solver.error.cancelled":
    "Solver-Lauf abgebrochen. Es wurden keine unvollständigen Kandidaten übernommen.",
  "candidates.solver.error.failed": "Solver fehlgeschlagen: {message}",
  "candidates.solver.error.workerUnknown":
    "Solver mit unbekanntem Worker-Fehler fehlgeschlagen.",
  "candidates.solver.progress.applying":
    "Paketeingaben werden vor der Erzeugung übernommen.",
  "candidates.solver.progress.starting": "Solver-Worker wird gestartet.",
  "candidates.solver.stale":
    "Der vorherige Solver-Lauf wurde verworfen, weil sich die Generator-Eingaben geändert haben.",
  "candidates.solver.labelFace.top":
    "+Y-Fläche — Kante parallel zur Paketlänge",
  "candidates.solver.labelFace.right":
    "+X-Fläche — Kante parallel zur Paketbreite",
  "candidates.solver.labelFace.bottom":
    "−Y-Fläche — Kante parallel zur Paketlänge",
  "candidates.solver.labelFace.left":
    "−X-Fläche — Kante parallel zur Paketbreite",
  "candidates.solver.progressTitle": "Muster werden erzeugt…",
  "candidates.solver.progressAria": "Fortschritt der Mustersuche",
  // Solver controls: guided
  "candidates.solver.guided.aria": "Mustersuche",
  "candidates.solver.guided.titleRunning": "Passende Muster werden gesucht",
  "candidates.solver.guided.titleDone": "Suche abgeschlossen",
  "candidates.solver.guided.titleIdle": "Muster berechnen",
  "candidates.solver.guided.subtitle": "{length} × {width} mm auf {pallet}",
  "candidates.solver.guided.palletFallback": "Palette",
  "candidates.solver.guided.stateRunning": "Berechnung läuft",
  "candidates.solver.cancelled": "Abgebrochen",
  "candidates.solver.guided.stateDistinct": "{count} unterschiedliche Muster",
  "candidates.solver.guided.stateReady": "Bereit",
  "candidates.solver.guided.phase.generation": "Muster erzeugen",
  "candidates.solver.guided.phase.validation": "Geometrie prüfen",
  "candidates.solver.guided.phase.ranking": "Muster sortieren",
  "candidates.solver.guided.phase.complete": "Abgeschlossen",
  "candidates.solver.guided.phase.normalization": "Eingaben prüfen",
  "candidates.solver.guided.phase.default": "Muster berechnen",
  "candidates.solver.guided.adjust": "Suche anpassen",
  "candidates.solver.guided.cancelRun": "Berechnung abbrechen",
  "candidates.solver.guided.recalculate": "Neu berechnen",
  "candidates.solver.guided.generate": "Muster erzeugen",
  "candidates.solver.guided.adjustParams": "Suchparameter anpassen",
  "candidates.solver.guided.packageLengthMm": "Paketlänge (mm)",
  "candidates.solver.guided.packageWidthMm": "Paketbreite (mm)",
  "candidates.solver.guided.packageHeightMm": "Pakethöhe (mm)",
  "candidates.solver.guided.lengthTotalMm":
    "Über-/Unterstand Länge gesamt (mm)",
  "candidates.solver.guided.widthTotalMm":
    "Über-/Unterstand Breite gesamt (mm)",
  "candidates.solver.guided.maxCandidates": "Max. Kandidaten je Generator",
  "candidates.solver.guided.maxPerGrip": "Max. Pakete je Griff",
  "candidates.solver.guided.mixOrientations": "Längs und quer kombinieren",
  "candidates.solver.multipick": "Mehrfachgriff erlauben",
  "candidates.solver.guided.symmetry": "Gespiegelte Varianten einbeziehen",
  "candidates.solver.guided.allowanceHint":
    "Der Über-/Unterstand wird gleichmäßig auf beide Seiten verteilt. Die Suchparameter ändern die gespeicherte Palettenfreigabe nicht.",
  "candidates.solver.guided.enterCount":
    "Geben Sie die gewünschte Anzahl Pakete je Lage ein.",
  "candidates.solver.guided.cancelledNotice":
    "Berechnung abgebrochen. Es wurden keine unvollständigen Muster übernommen.",
  "candidates.solver.guided.stale":
    "Die Suchparameter wurden geändert. Bitte berechnen Sie die Muster erneut.",
  "candidates.solver.guided.noMatch":
    "Kein passendes Muster gefunden. Ändern Sie die Paketanzahl oder die Suchparameter.",
  // Solver controls: classic form
  "candidates.solver.title": "Lagen-Solver",
  "candidates.solver.packageDimensions": "Paketmaße · mm",
  "candidates.solver.palletAllowance":
    "Gesamter Über-/Unterstand der Palette · mm",
  "candidates.solver.effectiveFrame": "Wirksamer Rahmen: {length} × {width} mm",
  "candidates.solver.required": "Pflichtfeld",
  "candidates.solver.noGripper":
    "Es ist kein Greifer ausgewählt, daher sind vorläufig alle vier orthogonalen Ablagedrehungen verfügbar. Wählen Sie einen Greifer, um seine genauen Drehgrenzen durchzusetzen.",
  "candidates.solver.allowMixed":
    "Gemischte Ausrichtungen längs / quer erlauben",
  "candidates.solver.advanced": "Erweiterte Erzeugung",
  "candidates.solver.candidatesSlash": "Kandidaten / Generator",
  "candidates.solver.blockSymmetries": "Blocksymmetrien einbeziehen",
  "candidates.solver.generatorMode": "Generator",
  "candidates.solver.generatorMode.combined":
    "Kombiniert (MultiPack zuerst, alter Generator im Hintergrund)",
  "candidates.solver.generatorMode.multipack": "Nur MultiPack",
  "candidates.solver.generatorMode.legacy": "Nur alter Generator",
  "candidates.solver.background.running":
    "Alter Generator läuft im Hintergrund – weitere Muster werden angehängt.",
  "candidates.solver.background.cancel": "Abbrechen",
  "candidates.solver.background.cancelled":
    "Alter Generator abgebrochen – nur MultiPack-Muster angezeigt.",
  "candidates.solver.background.failed":
    "Alter Generator fehlgeschlagen: {message}",
  "candidates.solver.cancel": "Abbrechen",
  "candidates.solver.applyAndSolve": "Eingaben übernehmen und lösen",
  "candidates.solver.preflightFailed": "Vorprüfung fehlgeschlagen.",
  "candidates.solver.ready":
    "Bereit: Paket {length} × {width} × {height} mm · Einlauf {orientation} von links nach rechts · L {lengthTotal}/B {widthTotal} mm gesamt · {count} Pakete · Etikett {label} · gemischte Ausrichtungen {mixed} · automatische Gruppierung {grouping}.",
  "candidates.solver.orientation.lengthwise": "längs",
  "candidates.solver.orientation.crosswise": "quer",
  "candidates.solver.labelUnconstrained": "nicht festgelegt",
  "candidates.solver.allowed": "erlaubt",
  "candidates.solver.disabled": "deaktiviert",
  "candidates.solver.groupingEnabled": "aktiviert bis {limit}",
  "candidates.solver.groupingDisabled": "deaktiviert; nur Einzelgriffe",
  "candidates.solver.resultCompleted": "Abgeschlossen",
  "candidates.solver.resultSummary":
    "{status}: {candidates} Kandidaten ({distinct} unterschiedliche Muster) aus {drafts} Entwürfen; {invalid} ungültig und {merged} gleichwertige Mustervarianten zusammengeführt.",
} as const;
