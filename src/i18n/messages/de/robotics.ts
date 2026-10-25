/** Namespace `robotics` — German source strings. */
export const roboticsDe = {
  // Workspace header
  "robotics.title": "Robotik & Greifer",
  "robotics.layerCount_one": "{count} Lage",
  "robotics.layerCount_other": "{count} Lagen",
  "robotics.layerCount": "{count} Lagen",
  "robotics.packageCount_one": "{count} Paket",
  "robotics.packageCount_other": "{count} Pakete",
  "robotics.packageCount": "{count} Pakete",
  "robotics.pickupCount_one": "{count} Griff",
  "robotics.pickupCount_other": "{count} Griffe",
  "robotics.pickupCount": "{count} Griffe",
  "robotics.summaryCalculated": "{layers} · {packages} · {pickups} berechnet",
  "robotics.noStack": "Kein gespeicherter Stapel",
  "robotics.openItems_one": "{count} offener Punkt",
  "robotics.openItems_other": "{count} offene Punkte",
  "robotics.openItems": "{count} offene Punkte",
  "robotics.openItemsUnderAdvanced": "{items} unter Technik",
  "robotics.exportEnabled": "Export freigegeben",
  "robotics.previewMotion": "Bewegung ansehen",
  "robotics.exportRob": ".rob exportieren",

  // Equipment panel
  "robotics.equipment": "Ausrüstung",
  "robotics.multipackProfile": "Multipack-Profil v{version}",
  "robotics.notDerivableFromImport": "aus .rob-Import nicht ableitbar",
  "robotics.checkAgainstRealCell": "gegen die reale Zelle prüfen",
  "robotics.gripper": "Greifer",
  "robotics.gripperOfPlan": "Greifer des Plans",
  "robotics.selectGripper": "Greifer wählen …",
  "robotics.palletStation": "Palettenstation",
  "robotics.palletStationOfPlan": "Palettenstation des Plans",
  "robotics.selectStation": "Station wählen …",
  "robotics.gripperType.suction": "Sauggreifer",
  "robotics.gripperType.clamp": "Klammergreifer",
  "robotics.gripperType.fork": "Gabelgreifer",
  "robotics.profileNote":
    "Aus „Multipack für Roboter“ {version}, nicht vermessen.",

  // Pickup panel
  "robotics.pickup": "Aufnahme",
  "robotics.pickupDerivedTop": "Oberkante Mitte der Paketgruppe",
  "robotics.pickupSurveyed": "vermessener Aufnahmepunkt",
  "robotics.packagesPerPickup": "Pakete je Griff",
  "robotics.pickupDerivedNote":
    "Aufnahme für {length} × {width} × {height} mm: einzeln {singleX} / {singleY} mm{grouped}. Z {height} mm, Drehung {yaw}°.",
  "robotics.pickupGroupedNote": ", {count}er-Griff {groupedX} / {groupedY} mm",
  "robotics.pickupSurveyedNote":
    "Es gelten die unter Technik eingetragenen vermessenen Koordinaten.",
  "robotics.calculatedPickups": "Berechnete Griffe",

  // Advanced section
  "robotics.advanced": "Technik",
  "robotics.noOpenItems": "keine offenen Punkte",
  "robotics.advancedWarning":
    "Greiferentwürfe und Zuordnungen sind ungeprüfte Technikdaten. Vor dem Einsatz gegen die reale Zelle prüfen.",
  "robotics.pickPointAndEvidence": "Aufnahmepunkt und Nachweis",
  "robotics.pickPointHint": "Leer = berechnete Oberkante Mitte.",
  "robotics.xMm": "X (mm)",
  "robotics.yMm": "Y (mm)",
  "robotics.zMm": "Z (mm)",
  "robotics.rotationDeg": "Drehung (°)",
  "robotics.transferClearance": "Fahrhöhe über dem Stapel (mm)",
  "robotics.pickReferenceStatus": "Stand des Aufnahmepunkts",
  "robotics.statusUnverified": "Nicht geprüft",
  "robotics.statusVerified": "Gegen die angegebene Quelle geprüft",
  "robotics.pickReferenceSource": "Quelle des Aufnahmepunkts",
  "robotics.fixedObstacles": "Feste Hindernisse",

  // Library panels
  "robotics.gripperLibraryTitle": "Greifer: Bibliothek und Editor",
  "robotics.gripperTemplates": "Greifervorlagen",
  "robotics.selectGripperTemplate": "Greifervorlage wählen …",
  "robotics.createSuctionGripper": "Neuen Sauggreifer anlegen (ungeprüft)",
  "robotics.gripperBuiltInLimits":
    "Maximale Grifflänge 450 mm. Paketgrenzen: längs 50–500 × 50–420 mm, quer 50–500 × 50–300 mm, Höhe 50–400 mm.",
  "robotics.gripperEmpty": "Greifer wählen oder anlegen, um ihn zu bearbeiten.",
  "robotics.stationLibraryTitle": "Palettenstation: Bibliothek und Editor",
  "robotics.stationTemplates": "Stationsvorlagen",
  "robotics.selectStationTemplate": "Stationsvorlage wählen …",
  "robotics.createStation": "Neue Station anlegen (ungeprüft)",
  "robotics.stationBuiltInLimits":
    "Palettenursprung rechts / unten. TCP-Hüllraum ±2000 mm, Freiraumkontur ±1500 mm. Radius 0 / 0 bleibt als unkalibrierter Platzhalter erhalten, die Reichweite wird nicht geprüft.",
  "robotics.stationEmpty": "Station wählen oder anlegen, um sie zu bearbeiten.",
  "robotics.apply": "Übernehmen",
  "robotics.removeFromLibrary": "Aus Bibliothek entfernen",
  "robotics.createEditableCopy": "Bearbeitbare Kopie anlegen",
  "robotics.saveToPlan": "Im Plan speichern",
  "robotics.saveAsTemplate": "Als Vorlage speichern",
  "robotics.builtInNotice":
    "Das mitgelieferte Multipack-Profil v{version} ist schreibgeschützt. Für Änderungen oder eine eigene Vorlage zuerst eine bearbeitbare Kopie anlegen.",

  // Retained import
  "robotics.importedOriginal": "Importierte Originaldatei",
  "robotics.downloadOriginal": "Original .rob herunterladen",
  "robotics.downloadEdited": "Bearbeitete .rob herunterladen",

  // Status and error messages
  "robotics.errorTemplateLibraryLoad":
    "Die Vorlagenbibliothek konnte nicht geladen werden.",
  "robotics.errorSaveFailed": "Speichern fehlgeschlagen.",
  "robotics.statusGripperApplied": "Greifer übernommen.",
  "robotics.statusGripperRemoved": "Greiferauswahl entfernt.",
  "robotics.statusStationApplied": "Palettenstation übernommen.",
  "robotics.statusStationRemoved": "Stationsauswahl entfernt.",
  "robotics.errorBuiltInGripperReadOnly":
    "Der mitgelieferte Multipack-Greifer ist schreibgeschützt. Zuerst eine bearbeitbare Kopie anlegen.",
  "robotics.errorBuiltInStationReadOnly":
    "Die mitgelieferte Multipack-Station ist schreibgeschützt. Zuerst eine bearbeitbare Kopie anlegen.",
  "robotics.errorBuiltInNotInLibrary":
    "Mitgelieferte Profile werden nicht in die Bibliothek übernommen. Zuerst eine bearbeitbare Kopie anlegen.",
  "robotics.statusGripperSaved": "Greifer „{name}“ im Plan gespeichert.",
  "robotics.statusStationSaved":
    "Palettenstation „{name}“ im Plan gespeichert.",
  "robotics.statusGripperTemplateSaved": "Greifervorlage „{name}“ gespeichert.",
  "robotics.statusStationTemplateSaved":
    "Stationsvorlage „{name}“ gespeichert.",
  "robotics.statusGripperTemplateApplied":
    "Greifervorlage „{name}“ in den Plan übernommen.",
  "robotics.statusStationTemplateApplied":
    "Stationsvorlage „{name}“ in den Plan übernommen.",
  "robotics.statusTemplateRemoved":
    "Vorlage aus der Bibliothek entfernt; die Kopie im Plan bleibt erhalten.",
  "robotics.statusRobExported":
    ".rob-Datei exportiert und per Parser-Rücklauf geprüft.",

  // Pickup table
  "robotics.col.layer": "Lage",
  "robotics.col.grip": "Griff",
  "robotics.col.packages": "Pakete",
  "robotics.col.pickX": "Aufnahme X",
  "robotics.col.pickY": "Aufnahme Y",
  "robotics.col.pickZ": "Aufnahme Z",
  "robotics.col.pickRotation": "Aufnahme Drehung",
  "robotics.col.transfer": "Transfer X/Y/Z",
  "robotics.col.placeX": "Ablage X",
  "robotics.col.placeY": "Ablage Y",
  "robotics.col.placeZ": "Ablage Z",
  "robotics.col.placeRotation": "Ablage Drehung",
  "robotics.col.frame": "Rahmen",
  "robotics.col.source": "Quelle",
  "robotics.noPickupsYet": "Noch keine Griffe berechnet.",

  // Diagnostics
  "robotics.diagnosticsDetail": "Diagnose im Detail",
  "robotics.diagnosticsNoCollision":
    "Keine festen Hindernisse modelliert; keine Aussage zur Kollision.",
  "robotics.diagnosticsNone": "Keine Hinweise.",
  "robotics.category.package": "Plan und Griffe",
  "robotics.category.gripper": "Greifer",
  "robotics.category.station": "Palettenstation",
  "robotics.category.reach": "Reichweite",
  "robotics.category.envelope": "Eingetragene Hüllräume",
  "robotics.category.collision": "Hindernisse",
  "robotics.category.export": "Export",

  // Readiness
  "robotics.readiness": "Bereitschaft",
  "robotics.readinessBlocked": "Griffdaten blockiert",
  "robotics.readinessAllPassed": "alle Prüfungen bestanden",
  "robotics.readinessChecked": "Projektdaten geprüft",
  "robotics.readinessDisclaimerStrong":
    "Produktionsfreigabe wird hier nicht bewertet.",
  "robotics.readinessDisclaimer":
    "Greifer, Stationsrahmen, Programmzuordnung, Schutzeinrichtungen und das vollständige Kollisionsmodell vor dem Einsatz an der Anlage prüfen.",
  "robotics.status.complete": "Bereit",
  "robotics.status.needs-input": "Eingabe nötig",
  "robotics.status.engineering": "Technik prüfen",
  "robotics.status.not-checked": "Nicht geprüft",
  "robotics.status.warning": "Prüfen",
  "robotics.status.blocked": "Blockiert",
  "robotics.item.plan": "Plan und Griffliste",
  "robotics.item.equipment": "Ausrüstung",
  "robotics.item.pickup": "Aufnahmepunkt",
  "robotics.item.workspace": "Arbeitsraum der Station",
  "robotics.item.obstacles": "Hindernisse",
  "robotics.item.export": "Export-Zuordnung",
  "robotics.evidence.planBlocked":
    "Der aktive Plan hat blockierende Gruppierungs- oder Reihenfolgeprobleme.",
  "robotics.evidence.planCalculated_one": "{count} Griff berechnet.",
  "robotics.evidence.planCalculated_other": "{count} Griffe berechnet.",
  "robotics.evidence.planCalculated": "{count} Griffe berechnet.",
  "robotics.evidence.planEmpty":
    "Zuerst ein Paketmuster erstellen und stapeln.",
  "robotics.evidence.equipmentMissing": "Greifer und Palettenstation wählen.",
  "robotics.evidence.equipmentBlocked":
    "Die gewählte Ausrüstung besteht die internen Verträglichkeitsprüfungen nicht.",
  "robotics.evidence.equipmentProfile":
    "Das beobachtete Multipack-Standardprofil ist gewählt. Seine Werte sind dokumentierte Belege, keine kalibrierte Produktionsausrüstung.",
  "robotics.evidence.equipmentOk":
    "Gewählter Greifer und gewählte Station bestehen die verfügbaren internen Prüfungen.",
  "robotics.evidence.pickupIncomplete":
    "Einen vermessenen Aufnahmepunkt eintragen oder X, Y und Z leer lassen, um die Oberkante Mitte der Paketgruppe zu verwenden.",
  "robotics.evidence.pickupBlocked":
    "Die Aufnahmewerte oder ihr Nachweis müssen korrigiert werden.",
  "robotics.evidence.pickupDerived":
    "Die Aufnahme liegt an der Oberkante Mitte jeder Paketgruppe, abgeleitet aus Paketmaß und Anzahl.",
  "robotics.evidence.pickupVerified":
    "Als gegen die angegebene Quelle geprüft markiert.",
  "robotics.evidence.pickupUnverified":
    "Koordinaten liegen vor, wurden aber nicht gegen die Station geprüft.",
  "robotics.evidence.workspaceNotChecked":
    "Ausrüstung wählen und Griffe berechnen, bevor Reichweite und Hüllräume geprüft werden.",
  "robotics.evidence.workspaceBlocked":
    "Mindestens ein Griff liegt außerhalb einer eingetragenen Reichweite oder eines Hüllraums.",
  "robotics.evidence.workspaceSentinel":
    "Eingetragene TCP- und Freiraum-Hüllräume enthalten die berechneten Griffe, die radiale Reichweite wurde aber nicht geprüft, da 0 / 0 ein unkalibrierter Altwert-Platzhalter ist.",
  "robotics.evidence.workspaceOk":
    "Eingetragene Reichweiten- und Hüllraumgrenzen enthalten die berechneten Griffe.",
  "robotics.evidence.obstaclesBlocked":
    "Eine berechnete Bewegung schneidet das modellierte Zufuhrband oder ein eingetragenes Hindernis, oder ein Hindernis ist ungültig.",
  "robotics.evidence.obstaclesChecked_one":
    "{count} eingetragenes Hindernis geprüft.",
  "robotics.evidence.obstaclesChecked_other":
    "{count} eingetragene Hindernisse geprüft.",
  "robotics.evidence.obstaclesChecked":
    "{count} eingetragene Hindernisse geprüft.",
  "robotics.evidence.obstaclesCheckedConveyor_one":
    "{count} eingetragenes Hindernis zusammen mit dem berechneten Zufuhrband geprüft.",
  "robotics.evidence.obstaclesCheckedConveyor_other":
    "{count} eingetragene Hindernisse zusammen mit dem berechneten Zufuhrband geprüft.",
  "robotics.evidence.obstaclesCheckedConveyor":
    "{count} eingetragene Hindernisse zusammen mit dem berechneten Zufuhrband geprüft.",
  "robotics.evidence.obstaclesConveyorOnly":
    "Das berechnete Zufuhrband wurde geprüft. Weitere Stationshindernisse sind nicht modelliert.",
  "robotics.evidence.obstaclesNone":
    "Keine festen Hindernisse modelliert. Die Kollision mit einzelnen Stationsobjekten wurde nicht geprüft.",
  "robotics.evidence.exportOk": "Interne Export-Vorprüfung bestanden.",
  "robotics.evidence.exportIssues_one":
    "{count} Export-Einstellung muss noch technisch geprüft werden.",
  "robotics.evidence.exportIssues_other":
    "{count} Export-Einstellungen müssen noch technisch geprüft werden.",
  "robotics.evidence.exportIssues":
    "{count} Export-Einstellungen müssen noch technisch geprüft werden.",

  // Obstacle editor
  "robotics.obstacleDefaultName": "Hindernis {number}",
  "robotics.addObstacle": "Hindernis hinzufügen",
  "robotics.obstacleNone":
    "Keine festen Hindernisse modelliert. Die Kollision mit einzelnen Stationsobjekten wurde nicht geprüft.",
  "robotics.obstacleNameOf": "Name von Hindernis {number}",
  "robotics.remove": "Entfernen",
  "robotics.minX": "Min X",
  "robotics.minY": "Min Y",
  "robotics.maxX": "Max X",
  "robotics.maxY": "Max Y",
  "robotics.minZ": "Min Z",
  "robotics.maxZ": "Max Z",

  // Export mapping
  "robotics.exportMapping": "Export-Zuordnung (.rob)",
  "robotics.quantization": "Ganzzahl-Rundung",
  "robotics.quantization.round": "Auf ganze Zahl runden",
  "robotics.quantization.truncate": "Nachkommastellen abschneiden",
  "robotics.quantization.reject": "Dezimalwerte ablehnen",
  "robotics.lastTwoFields": "Letzte zwei .rob-Felder",
  "robotics.lastTwoFieldsAria": "Behandlung der letzten .rob-Felder",
  "robotics.unknownField.block": "Blockieren: Bedeutung unbekannt",
  "robotics.unknownField.fromCycle": "Griff-dx/dy, sonst 0",
  "robotics.unknownField.preserve": "Importierte Werte beibehalten",
  "robotics.unknownField.explicit": "Werte eintragen",
  "robotics.countOnlyInterlayers":
    "Nur Anzahl exportieren, wenn Zwischenlagen nicht 3 mm sind",
  "robotics.mappingId": "Interne Zuordnungs-ID",
  "robotics.signX": "Vorzeichen X",
  "robotics.signY": "Vorzeichen Y",
  "robotics.signRotation": "Vorzeichen Drehung",
  "robotics.rotationOffset": "Drehungs-Offset (°)",
  "robotics.acknowledgeAria": "Ungeprüfte .rob-Zuordnung bestätigen",
  "robotics.acknowledgeText":
    "Diese Zuordnung ist selbst eingetragen und belegt keine externe Multipack-Kompatibilität.",
  "robotics.field8": "Feld 8",
  "robotics.field9": "Feld 9",
  "robotics.fieldsMeaning": "Bedeutung der Felder 8 und 9",
  "robotics.fieldsSource": "Quelle dieser Werte",

  // Resource editors
  "robotics.name": "Name",
  "robotics.externalId": "Externe ID",
  "robotics.gripperKind": "Bauart",
  "robotics.kind.suction": "Sauggreifer",
  "robotics.kind.clamp": "Klammergreifer (Mechanik ungeprüft)",
  "robotics.kind.fork": "Gabelgreifer (Mechanik ungeprüft)",
  "robotics.inletDirection": "Einlaufrichtung",
  "robotics.inlet.any": "Beliebig",
  "robotics.inlet.lengthwise": "Längs",
  "robotics.inlet.crosswise": "Quer",
  "robotics.maxPickupLength": "Maximale Grifflänge (mm, leer = unbekannt)",
  "robotics.tcpLegend": "Werkzeugmittelpunkt TCP (mm)",
  "robotics.toolEnvelope": "Hüllraum des Werkzeugs (mm)",
  "robotics.allowedPlaceRotations": "Erlaubte Ablagedrehungen",
  "robotics.packageLimits": "Paketgrenzen (mm)",
  "robotics.checkPackageLimits": "Paketmaße gegen diesen Greifer prüfen",
  "robotics.multipickShared":
    "Mehrfachgriff mit geteilter Ablage (übernommen, erzeugte geteilte Ablage ungeprüft)",
  "robotics.otherGripperWarning":
    "Einstellungen für {kind} werden gespeichert, die erzeugte Greifmechanik ist aber ungeprüft und blockiert den Export.",
  "robotics.palletOriginX": "Palettenursprung X",
  "robotics.palletOriginY": "Palettenursprung Y",
  "robotics.left": "Links",
  "robotics.center": "Mitte",
  "robotics.right": "Rechts",
  "robotics.bottom": "Unten",
  "robotics.top": "Oben",
  "robotics.inletAlignment": "Ausrichtung am Einlauf",
  "robotics.tcpEnvelope": "TCP-Hüllraum",
  "robotics.obstacleEnvelope": "Freiraum / Hinderniskontur",
  "robotics.robotCenterRange": "Robotermitte und Reichweite (mm)",
  "robotics.centerX": "Mitte X",
  "robotics.centerY": "Mitte Y",
  "robotics.radiusMin": "Radius min.",
  "robotics.radiusMax": "Radius max.",
  "robotics.rangeUncalibrated":
    "0 / 0 bedeutet: Reichweite nicht kalibriert. Die Reichweitenprüfung wird übersprungen, bis ein gemessener Bereich eingetragen ist.",
  "robotics.palletizingDirections": "Palettierrichtungen",
  "robotics.preferredDirection": "Bevorzugte Richtung",
} as const;
