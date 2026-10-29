# Roadmap zum MultiPack-nahen Palettierplaner

Stand: 05.08.2026

Umsetzungsstatus: **M0–M8 sind als durchgängiger interner Produktworkflow
implementiert.** Projekte lassen sich ohne `.rob` anlegen, validieren, lokal
speichern, lösen, vergleichen, zu Stapeln kombinieren, in Muster-/Reihenfolge-/
Ablaufmodi bearbeiten, robotisch prüfen, simulieren, berichten und kontrolliert
exportieren. Der bestehende `.rob`-Viewer/-Editor bleibt parallel vollständig
nutzbar. Der automatisierte Stand umfasst 55 Testdateien mit 254 bestandenen Tests,
TypeScript-, ESLint-, Prettier- und Produktions-Build-Gates sowie einen im Browser
geprüften Create-Solve-Stack-Reload- und Legacy-Import-Ablauf.

Offen bleiben ausschließlich evidenzgebundene Fremdparitätsfragen: das vollständige
AP5006-Referenzpaket, die MultiPack-Semantik von „Blöcke“, die externen
Vorzeichen-/Schlussfeldkonventionen, reale Produktionskinematik/-kollisionen und
das proprietäre `.mpb`-Format. Diese Grenzen werden in UI, Export und Bericht als
Observed, Open, internal oder unverified ausgewiesen und nicht als Kompatibilität
behauptet.

Grundlage ist die Bestandsaufnahme `MultiPack_Roboter_Rebuild_Spec.md` vom
05.08.2026. Das Ziel ist keine pixelgenaue Kopie der alten Windows-Oberfläche,
sondern ein moderner Web-Workflow mit möglichst hoher funktionaler
Übereinstimmung: Projekt erfassen, viele brauchbare Lagenmuster berechnen,
visuell vergleichen, bearbeiten, robotisch prüfen, speichern und als `.rob`
ausgeben.

## Zielbild

Ein Benutzer kann ohne vorhandene `.rob`-Datei:

1. Produkt, Packstück, Palette, Greifer und Palettierplatz definieren.
2. eine breite, reproduzierbare Menge unterschiedlicher Lagenmuster berechnen;
3. die Kandidaten nach Stückzahl filtern und mit den Pfeiltasten visuell
   vergleichen;
4. zwei Lagenmuster zu einem vollständigen Stapel kombinieren;
5. Positionen, Greifgruppen, Reihenfolge, Etiketten und Zwischenlagen
   nachbearbeiten;
6. Maße, Auslastung, Gewicht, Zyklen und Robotergrenzen prüfen;
7. Ablauf und Greiferbewegung simulieren;
8. das Projekt wieder öffnen, dokumentieren und als validierte `.rob`-Datei
   ausgeben.

Der vorhandene Viewer und Editor werden weiterverwendet. Sie bilden bereits das
Visualisierungs- und Bearbeitungsfundament; die Roadmap ergänzt vor allem den
fehlenden Planungs-, Solver- und Robotik-Unterbau.

## Ausgangslage

### Belastbar implementiert

- `.rob`-Import mit zeilengenauen Fehlern, Original-/Editiert-Ansicht,
  Parser/Serializer-Roundtrip, lokaler Bibliothek und bestehendem 2D-/3D-Editor
- versioniertes Projektmodell, deterministische Migration, getrennte
  Projekt-/Ressourcen-Stores, Suche, Sortierung, Duplizieren, „Speichern unter“
  sowie portable JSON-Pakete
- Projekt-/Packstückdialog mit Standard- und benutzerdefinierten Paletten,
  Über-/Unterhang, Stauraum, Tara und Maximalgewicht
- deterministischer Reihen-/Block-/Rand-/Mischmuster-Solver im Web Worker mit
  Fortschritt, Abbruch, stabiler Identität, Deduplizierung und Diagnosen
- Kandidatentabelle mit Anzahl-/Maximumfilter, `x von y`, Pfeiltastennavigation,
  SVG-Miniaturen und unmittelbarer 3D-Vorschau
- Stapelkomposition, freie Lagenfolge, Spiegelungen/Rotationen, Sonderlage,
  variable Zwischenlagen, Produktionsmetriken und Grenzwarnungen
- Projekteditor mit Muster-, Reihenfolge- und Flow-Modus, Mehrfach-/Rahmenauswahl,
  Feinbewegung, Etiketten, Greifgruppen, Abhängigkeiten und gemeinsamer Historie
- Greifer-/Stationsressourcen, Multipick-Zyklen, TCP-/Reichweiten-/Hüllraum- und
  einfache Kollisionsdiagnosen sowie streng vorgeprüfter Projekt-`.rob`-Export
- deterministische RobotCycle-Timeline, Vor-/Rückwärtssteuerung, feste Ansichten
  und vereinfachte Roboter-/Greifervisualisierung
- Druck-/PDF-Ansicht, Kennzahlen-/Warnungs-/Zyklusbericht und ausdrücklich
  unverified, ausschließlich lesende `.mpb`-Diagnosegrenze
- automatisierte Basis: 55 Testdateien mit 254 bestandenen Tests

### Weiterhin evidenzgebunden offen

- vollständige MultiPack-Kandidatenfamilien und exaktes Ranking für AP5006
- genaue Bedeutung und Bewertung von „Blöcke“
- externe Etikett-, Vorzeichen- und letzte `.rob`-Feldsemantik
- reale Roboterkinematik, Produktionskollisionen und Portalroboter
- proprietäre `.mpb`-Dekodierung und ein Writer

## Leitplanken

1. **Funktionsparität vor Oberflächenparität.** Der Kernablauf muss dieselben
   Entscheidungen ermöglichen; das Web-UI darf moderner und kompakter bleiben.
2. **Breite Kandidatenmenge statt eines einzigen Optimums.** Geometrisch
   unterschiedliche Muster bleiben erhalten, auch wenn Stückzahl und Blockmaß
   gleich sind.
3. **Deterministisch und erklärbar.** Gleiche Eingaben erzeugen dieselben
   Kandidaten in derselben Reihenfolge. Bewertungen und Ausschlussgründe sind
   sichtbar.
4. **Reiner Domain-Kern.** Geometrie, Solver, Metriken, Transformationen und
   Robotik bleiben von React und Three.js getrennt und werden direkt getestet.
5. **Referenzgetriebene Parität.** Evidenz wird ausdrücklich als Golden,
   Observed oder Open geführt. Beobachtungen werden erst mit anonymisierter,
   ausführbarer Grundlage zu Golden Cases; ungeklärte Heuristiken werden nicht
   geraten oder still als kompatibel bezeichnet.
6. **Bestehende `.rob`-Workflows nicht brechen.** Import, Bearbeitung,
   Roundtrip und lokale Bibliothek bleiben während des Umbaus nutzbar.

## Releases und Meilensteine

Aufwandsgrößen sind relative T-Shirt-Größen und keine Kalenderzusagen.

### R0 – Viewer/Editor-Basis (heutiger Stand)

Status: vorhanden

Das Produkt kann vorhandene `.rob`-Pläne prüfen, visualisieren, lokal verwalten
und begrenzt nachbearbeiten. Dies bleibt die stabile Basis aller folgenden
Releases.

### M0 – Referenzkorpus und Paritätsmessung

Status: abgeschlossen · Aufwand: S · Abhängigkeit: keine

Umfang:

- drei bis fünf anonymisierte/synthetische Referenzprojekte mit Eingaben,
  erwarteten Kennzahlen und maschinenlesbaren Artefaktverweisen zusammenstellen;
  Screenshots und Exporte nur bei tatsächlich verfügbarer Evidenz referenzieren;
- den Lauf `AP5006 / 1329-00004` als primären beobachteten Solver-Zielfall
  beschreiben und erst mit ausführbarer Evidenz zu Golden hochstufen;
- Kandidatenidentität und geometrische Gleichheit formal definieren;
- offene `.rob`-Felder, „Blöcke“-Semantik und Solverabweichungen in einem
  Research-Log führen;
- eine Paritätsmatrix pro Referenzprojekt anlegen.

Exit-Kriterien:

- Erwartungswerte lassen sich automatisiert laden, ohne private Originaldaten
  in das Repository zu übernehmen.
- Für jede spätere Solveränderung ist messbar, was näher an MultiPack liegt und
  was sich verschlechtert hat.

### M1 – Vollständiges Projekt- und Domänenmodell

Status: implementiert · Aufwand: M · Abhängigkeit: M0

Umfang:

- versioniertes Modell für `Project`, `Package`, `Pallet`, `Gripper`,
  `PalletStation`, `Solution`, `LayerPattern`, `LayerStack` und `RobotCycle`;
- klare Trennung zwischen importierter `.rob`-Quelle und editierbarem Projekt;
- Projekt-anlegen/-ändern-Dialog mit Quader, Abmessungen, Gewicht, Abstand,
  Einlaufrichtung und Mehrfachgreifen;
- EURO-, Industrie- und benutzerdefinierte Palette mit Über-/Unterhang,
  Stauraum, Tara und Maximalgewicht;
- Schema-Migration der bestehenden IndexedDB-Daten;
- portabler JSON-Export/-Import als Sicherungs- und Diagnoseformat.

Exit-Kriterien:

- Ein neues Projekt kann ohne `.rob` angelegt, validiert, gespeichert und wieder
  geöffnet werden.
- Bestehende gespeicherte `.rob`-Pläne bleiben lesbar und roundtrip-fähig.

### M2 – Deterministischer Lagen-Solver v1

Status: implementiert · Aufwand: XL · Abhängigkeit: M1

Umfang:

- 0°-/90°-Rechteckpackung innerhalb von Palette, Abstand und Überhang;
- Generatoren für Reihen-, Block-, Rand- und Mischmuster;
- Symmetrievarianten erzeugen, aber nur echte geometrische Duplikate entfernen;
- stabile Kandidaten-ID aus Placement-Geometrie, Orientierung und Griffdaten;
- Kennzahlen für Stückzahl, Fläche, Blockmaß und vorläufige Zykluszahl;
- deterministische Bewertung und Sortierung;
- Solver-Ausführung in einem Web Worker mit Fortschritt und Abbruch;
- property-basierte Prüfungen für Überlappung, Begrenzung und Determinismus.

Exit-Kriterien:

- Jede Ausgabe ist geometrisch zulässig und bei gleichen Eingaben reproduzierbar.
- Der Referenzfall erreicht 55 Packstücke je Lage.
- Der Solver behält mehrere unterschiedliche 55er-Muster. Die beobachteten
  `65 gesamt / 15 mit 55` sind ein Paritätsziel, aber erst dann ein hartes Gate,
  wenn die zugrunde liegenden MultiPack-Regeln ausreichend geklärt sind.

### M3 – Kandidatenbrowser und unmittelbarer visueller Vergleich

Status: implementiert · Aufwand: L · Abhängigkeit: M2

Umfang:

- fokussierbare, scrollbare Lösungstabelle mit Nr., Anzahl, Status, Blöcken,
  Zyklen, Länge und Breite;
- exakter Anzahlfilter, Schnellwahl „Maximum“ und sichtbares `x von y`;
- Pfeil-hoch/-runter wechselt die aktive Zeile und hält sie im Viewport;
- sofortige 2D-Miniaturen, Kennzahlen und große 3D-Vorschau ohne Solver-Neulauf;
- stabile Sortierung und Filter-Reset ohne Verlust von Kandidaten;
- Diagnoseansicht für Score und Ausschlussgründe.

Exit-Kriterien:

- Der in der Spezifikation beschriebene visuelle Abgleich ist vollständig mit
  Maus und Tastatur möglich.
- Ein Kandidatenwechsel aktualisiert die sichtbaren Vorschauen ohne merkliche
  Verzögerung.

Ergebnis von M0–M3: **Planner Alpha**. Ab hier entsteht ein Plan erstmals aus
Eingabedaten statt nur aus einem `.rob`-Import.

### M4 – Stapelkomposition und Produktionskennzahlen

Status: implementiert · Aufwand: L · Abhängigkeit: M3

Umfang:

- zwei Lagenmuster auswählen und als Turm, Längsspiegel, Querspiegel oder
  Rotation kombinieren;
- Lagenzahl aus Stauraumhöhe, Packstückhöhe und Zwischenlagen ableiten;
- frei editierbare Lagenfolge;
- Zwischenlagenregeln mit Dicke, Boden- und Deckellage;
- abweichende obere Lage mit eigener Kandidatenliste;
- Flächen-/Volumennutzung, Gesamtgewicht, Blockmaß und Grenzwarnungen;
- 3D-Optionen „obere Lage anheben“, Aufsichten und Lagenbezeichnungen.

Exit-Kriterien:

- Vollständiger Stapel, Kennzahlen und Warnungen reagieren konsistent auf jede
  Lagen-, Zwischenlagen- oder Sonderlagenänderung.
- Die Beispielrechnung `55 × 10 = 550` sowie Höhe, Fläche und Volumen sind als
  Golden Tests abgedeckt.

### M5 – Lageneditor- und Reihenfolge-Parität

Status: implementiert · Aufwand: L · Abhängigkeit: M4

Umfang:

- getrennte Arbeitsmodi für Muster, Reihenfolge und 2D-Ablaufprüfung;
- Strg-Mehrfachauswahl, Shift-Rahmen, Zentrieren und Feinpositionierung;
- längs/quer einfügen und Etikettenseite ändern;
- Greifgruppen explizit nummerieren, ergänzen und entfernen;
- automatische Reihenfolge als editierbarer Vorschlag;
- Pick-/Place-TCP, Winkel, Gruppe und Status schrittweise anzeigen;
- bestehende Undo/Redo- und Kollisionsprüfungen auf alle Aktionen ausweiten.

Exit-Kriterien:

- Eine importierte oder berechnete Lage kann ohne Textbearbeitung vollständig
  verändert und wieder als semantisch gleiche `.rob`-Struktur serialisiert
  werden.
- Der bekannte 55er-Referenzplan kann als 36 Zyklen mit 19 Doppel- und 17
  Einzelgriffen dargestellt werden.

### M6 – Greifer, Palettierplatz und robotisch valider Export

Status: intern implementiert, Fremdsemantik teilweise Open · Aufwand: XL · Abhängigkeit: M5

Umfang:

- Greiferbibliothek mit TCP, Hülle, Winkeln, Maßgrenzen und Einlaufrichtung;
- Sauger zuerst, Klemm- und Gabelgreifer anschließend;
- Palettierplatz mit Ursprung, Störkontur, TCP-Grenzen, Richtungen, Radius und
  Einlauf-Ausrichtung;
- Multipick-Gruppierung und Pick-/Place-TCP-Berechnung;
- Reichweiten-, Hüllraum- und einfache Kollisionsprüfung;
- `.rob`-Export aus dem Projektmodell statt bloßem Roundtrip;
- kontrollierte Vergleichsexporte zur Verifikation der letzten beiden
  `.rob`-Felder und aller Vorzeichenkonventionen.

Exit-Kriterien:

- Jede exportierte Zykluszeile ist aus dem Projektmodell erklärbar und gegen
  Golden Files geprüft.
- Ungültige Greifer-, Winkel-, Stations- oder Hüllraumkombinationen werden vor
  dem Export verständlich blockiert.

Ergebnis von M4–M6: **Robot-ready Beta**. Pläne können entworfen, bearbeitet,
robotisch geprüft und gezielt exportiert werden.

### M7 – Robotersimulation

Status: implementiert · Aufwand: L · Abhängigkeit: M6

Umfang:

- Timeline aus Pick-, Transfer- und Place-Phasen;
- Start/Stop, Schritt, Zurück, Ende und Geschwindigkeitsregler;
- Greiferanzeige für X/Y/Z/Winkel und aktuelle Gruppe;
- feste Ansichten oben, vorne und rechtsoben plus Zoom;
- Einlaufband, Palette, Greifer und zunächst vereinfachter Knickarm;
- Bewegungsdauer aus konfigurierten Geschwindigkeiten und Pick-/Place-Zeiten;
- Portalroboter und detaillierte Kinematik erst nach dem verifizierten Ablauf.

Exit-Kriterien:

- Jede Robotergruppe lässt sich vorwärts und rückwärts deterministisch abspielen.
- Simulation und `.rob`-Export verwenden exakt dieselben `RobotCycle`-Daten.

### M8 – Bericht, Projektverwaltung und Legacy-Kompatibilität

Status: bis zur dokumentierten Evidenzgrenze implementiert · Aufwand: L bis XL · Abhängigkeit: M6, für Simulationsteil M7

Umfang:

- Projekt-/Produktfilter, Sortierung, Duplizieren und „Speichern unter“;
- Druckansicht/PDF mit 2D-/3D-Bild, Kennzahlen und Roboterzyklen;
- Import-/Exportpaket für Projekt, Greifer und Palettierplatz;
- optionaler, ausschließlich lesender `.mpb`-Importer für sicher dekodierte
  Format-v1-Felder;
- proprietärer `.mpb`-Writer nur nach vollständigem Feldverständnis und mit
  echten Kompatibilitätstests.

Exit-Kriterien:

- Ein Projekt kann gesucht, dupliziert, portabel gesichert und als Bericht
  weitergegeben werden.
- Legacy-Importe kennzeichnen unbekannte oder nicht verifizierte Felder offen.

Ergebnis von M7–M8: **Parity Candidate** für den beobachteten Kernworkflow.

## Technischer Zielschnitt

```text
src/domain/
├─ project/        Stammdaten, Validierung, Metriken
├─ geometry/       Rechtecke, Transformationen, Kollisionen
├─ solver/         Generatoren, Deduplizierung, Ranking
├─ stack/          Lagenfolge, Verbund, Zwischen-/Sonderlagen
├─ robotics/       Greifer, Station, Zyklen, Grenzen
└─ formats/        internes Schema sowie .rob-Adapter

src/workers/       Solver-Ausführung und Fortschritt
src/features/      Projekt, Kandidaten, Editor, Simulation, Bericht
src/components/    wiederverwendbare UI und bestehender Viewer
```

`PalletData` bleibt zunächst der kompatible Viewer-/Editor-DTO. Das neue
Projektmodell liefert daraus gezielt eine Vorschau. So muss der bestehende
Viewer nicht gleichzeitig mit dem Solver neu geschrieben werden.

## Paritäts-Scorecard

Jeder Referenzfall erhält nach jedem Meilenstein dieselbe Bewertung:

| Dimension   | Messung                                                    |
| ----------- | ---------------------------------------------------------- |
| Eingabe     | alle beobachteten Felder modelliert und validiert          |
| Geometrie   | maximale Stückzahl und vorhandene Musterfamilien           |
| Vielfalt    | Anzahl unterschiedlicher Kandidaten bei gleicher Stückzahl |
| Ranking     | Position des visuell passenden Referenzmusters             |
| Stapel      | Lagenfolge, Höhe, Zwischenlagen, Gewicht und Blockmaß      |
| Robotik     | Gruppen, Reihenfolge, TCP, Winkel und Zykluszahl           |
| Export      | semantischer Vergleich jeder `.rob`-Zeile                  |
| Bedienung   | Kernablauf per Maus und Tastatur ohne Umweg möglich        |
| Performance | Solverzeit und Vorschauwechsel für das Referenzgerät       |

Eine Funktion gilt nicht schon dann als „fertig“, wenn die UI existiert. Sie
braucht mindestens einen Domain-Test, einen Referenzfall und eine sichtbare
Fehlerbehandlung.

## Die nächsten zehn umsetzbaren Arbeitspakete

Diese Reihenfolge ist der empfohlene Start; sie vermeidet eine frühe
Großumgestaltung der vorhandenen Oberfläche.

1. anonymisiertes Golden-Case-Format und Paritätsmatrix definieren;
2. `Project`-Schema v2 samt Zod-Validierung und Migration entwerfen;
3. Adapter `Project/Solution -> PalletData` implementieren;
4. Projekt- und Packstückdialog als schmalen End-to-End-Slice bauen;
5. Palettenvorlagen, Überhang und Hüllraumvalidierung ergänzen;
6. reine Metrikfunktionen für Fläche, Volumen, Höhe und Gewicht implementieren;
7. kanonische Kandidaten-ID und echte Geometrie-Deduplizierung testen;
8. ersten Reihen-/Blockmuster-Generator implementieren;
9. Solver-Worker mit Fortschritt, Abbruch und deterministischer Sortierung
   anbinden;
10. Kandidatentabelle mit Anzahlfilter, `x von y` und Pfeiltastennavigation vor
    die vorhandene 3D-Vorschau setzen.

Der erste sichtbare Produkt-Inkrement endet bei Paket 4: Ein Projekt wird ohne
`.rob` angelegt und als noch manuelles Ein-Lagenmuster im bestehenden Viewer
angezeigt. Danach kann der Solver schrittweise ergänzt werden, ohne lange ohne
vorzeigbaren End-to-End-Stand zu arbeiten.

## Offene Forschungsfragen

- genaue Bedeutung und Bewertung von „Blöcke“
- vollständige Erzeugungs- und Rankingheuristik des Original-Solvers
- Stabilitätsregeln über benachbarte Lagen
- exakte Etikettenregeln und deren Einfluss auf Kandidatenidentität
- Bedeutung und Vorzeichen der letzten beiden `.rob`-Zyklusfelder
- Greifer-/Stations-Kollisionsmodell und reale Kinematik
- notwendiger Umfang eines `.mpb`-Imports

Diese Fragen laufen als Research-Track neben der Produktentwicklung. Sie dürfen
Meilensteine verfeinern, sollen aber nur die Teile blockieren, für die exakte
Kompatibilität tatsächlich nötig ist.

## Bewusste Nicht-Ziele vor der Planner Alpha

- pixelgenaue Nachbildung der Delphi-/MDI-Oberfläche
- Portalroboter oder fotorealistische Robotermodelle
- proprietärer `.mpb`-Writer
- automatische Bildähnlichkeitssuche
- vollständige Kollisionskinematik
- Cloud-Konten, Mehrbenutzerbetrieb oder Serverbetrieb

Damit bleibt der Fokus auf dem Alleinstellungsmerkmal: viele sinnvolle Muster
erzeugen und genauso schnell visuell vergleichen und robotisch weiterbearbeiten
wie im beobachteten MultiPack-Workflow.
