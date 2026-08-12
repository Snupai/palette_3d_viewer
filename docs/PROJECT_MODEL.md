# Project-v2-Domänenmodell

Stand: 05.08.2026

`ProjectV2` bleibt der kompatible Vertrag für die vorhandenen Fixtures und
`.rob`-Adapter. Das kanonische Arbeits- und Speicherformat ist die daraus
explizit migrierte aktuelle Projektversion. Sie ergänzt einzelne
Packstückplatzierungen und Roboterzyklen, ohne den V2-Vertrag umzudeuten. Das
bisherige `PalletData` bleibt vorerst ein kompatibler DTO für `.rob`, Viewer und
Lageneditor.

## Enthaltene Bereiche

- Projekt- und Produktnummer sowie Erstellungs-/Änderungszeit
- Herkunft als neues Projekt oder `.rob`-Import
- Packstück mit Form, Maßen, Gewicht, Abstand, Einlaufrichtung, Labelseiten und
  Mehrfachgreifen
- Palette mit Typ, Maßen, Stauraum, Über-/Unterhang, Tara und Maximalgewicht
- Greifer inklusive TCP, Hülle, Winkel, Maßgrenzen und typabhängigen Feldern
- Palettierplatz inklusive Ursprung, Stör-/TCP-Kontur, Richtungen und Radius
- mehrere Lösungen mit einzelnen Packstückplatzierungen, Lagenmustern,
  versionierten Lagenstapeln, Roboterzyklen und vollständiger Lagenfolge
- ausgewählter Greifer, Palettierplatz und aktive Lösung über geprüfte Referenzen

Das Schema prüft unter anderem eindeutige IDs, alle Querverweise, Zeitstempel,
Min-/Maxbereiche, Palettengewicht und bevorzugte Palettierrichtung.

## Maßachsen

Das Projektmodell verwendet fachlich eindeutige Namen:

```text
dimensionsMm.length × dimensionsMm.width × dimensionsMm.height
```

Das historische `PalletData` übernimmt dagegen die Reihenfolge der `.rob`-
Zeilen in den Feldern `width × length × height`. Beim Adapter gilt deshalb:

| Projektmodell | `.rob`-/Viewer-DTO                |
| ------------- | --------------------------------- |
| `length`      | `width` bzw. erstes `.rob`-Feld   |
| `width`       | `length` bzw. zweites `.rob`-Feld |
| `height`      | `height` bzw. drittes `.rob`-Feld |

Diese Abbildung ist durch einen semantischen Import-Projekt-Viewer-Roundtrip
getestet.

## Importierte Altpläne

Ein `.rob`-Import enthält nicht alle Projektdaten. Der Adapter markiert deshalb
folgende Werte ausdrücklich als unbekannt, statt sie aus Dateinamen oder
Geometrie zu erraten:

- Gewicht
- Paletten-Stauraum
- Tara und maximales Bruttogewicht
- Palettierrichtung
- Greiferdefinition und Palettierplatz
- Projektbezeichnung

Packstück- und Palettenmaße, Einlaufrichtung, Lagenmuster, Pick-/Place-Werte,
Greifgruppen, Reihenfolge und Zwischenlagen werden übernommen. Der Dateiname
ohne `.rob` wird als vorläufige Produktnummer verwendet.

## Kompatibilitätsfluss

```text
SavedPallet / .rob
        │
        ▼
savedPalletToProjectV2
        │
        ▼
ProjectV2 ── migrateProject ──▶ aktuelles Project
        │                              │
        └── projectSolutionToPalletData ◀┘ ──▶ bestehender Viewer/Editor
```

Damit können Projektformular und Solver schrittweise auf dem aktuellen
Projektmodell aufbauen, ohne den stabilen `.rob`-Workflow gleichzeitig
umzuschreiben.

## Persistenz und portable Sicherung

Die bestehende IndexedDB `pallets-db` behält den Store `pallets` unverändert.
Dazu kommen getrennte Stores für Projekte, wiederverwendbare Ressourcen und
Quarantäne-Datensätze. Laden und Importieren erfolgen über eine sichere
Versionsweiche; unbekannte oder beschädigte Datensätze werden mit Pfad-Diagnosen
quarantänisiert, statt still umgedeutet zu werden.

Die Migration aus `SavedPallet` erzeugt deterministische Platzierungs- und
Zyklus-IDs. Sie kopiert in den Projekt-Store und löscht den `.rob`-Quelldatensatz
nicht. Portable JSON-Pakete können mehrere Projekte sowie Paletten-, Greifer- und
Palettierplatzressourcen enthalten und unterstützen die Konfliktregeln
`skip`, `overwrite` und `rename`.
