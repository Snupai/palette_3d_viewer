# MultiPack-Fortsetzung – 08.09.2026

## Wiederhergestellte Desktop-Sitzung

Die isolierte MultiPack-Kopie wurde nach einem Lauf mit zehn leeren Paletten neu gestartet. Dieser Fehlversuch wird nicht als Oracle-Ergebnis gewertet. EXE-Version **2.1.315.25**, erneut geprüfter SHA-256 `629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff`. Es läuft die bereits angelegte beschreibbare Kopie; bestehende Projekte und Captures wurden nicht überschrieben.

Nach dem Neustart wurden 201 × 139 und anschließend die zuvor nicht zur Anpassung verwendeten 203 × 139 mm vollständig erfasst: jeweils 87 Lösungen, zusammen **174 neue gültige Exporte**. EURO 1200 × 800, Höhe 231, Abstand 0, Mehrfachgreifen aktiv, Einlauf längs; Maße und Einlauf sind exportverifiziert, übrige Eingaben UI-bestätigt. Kein Stückzahlfeld wurde verwendet.

**Die Wiederholung ist operativ nicht identisch:** Alle 87 Rechteckgrundflächen des Referenzfalls stimmen am jeweiligen Listenrang mit dem 07.09. innerhalb der definierten ROB-Toleranz überein. Die gerichteten Geometriefingerprints und Byte-Hashes stimmen dagegen bei keinem Kandidaten überein. Die neue Sitzung enthält zusätzliche Winkel 180° und 270°; schon der erste Kandidat hat dieselben 31 Pakete und 22 Griffe, jedoch andere gerichtete Winkel. Deshalb werden die Sitzungen getrennt ausgewertet. Ursache und vollständige Etiketten-/Orientierungseinstellungen sind noch nicht geklärt; aus den sichtbaren vier Rotationsfreigaben allein folgt keine identische operative Konfiguration.

## Implementierte Suchänderung

Die Regionensuche teilt das nach der Vorbereitung verbleibende Arbeitsbudget in feste Abschnitte für Zielstückzahlen ab der größten katalogisierten Rasterbelegung. Sie beginnt absteigend und wechselt nach einem Abschnitt zur nächsten noch offenen dichten Zielzahl. Nach Erschöpfung dieser Suchzustände bleiben niedrigere Zielzahlen absteigend erreichbar. Keine Zielzahl wird durch diese Planung aus der Suchmenge entfernt. Das globale Budget bleibt unverändert; ein einzelner nicht unterbrechbarer Suchschritt kann seinen Abschnitt überschreiten.

Das vermeidet, dass geometrisch fragliche hohe Zielzahlen allein die freie Suche dominieren. Die Rastergrenze stammt aus dem Formkatalog, nicht aus einer Oracle-Fallnummer oder festen Belegungsquote. Arbeitsmodellversion **9** kennzeichnet die geänderte Planung. Exakte Einzelstückzahlabfragen behalten ihre bisherige Planung.

Ein erster Versuch mit gleicher Budgetverteilung über sämtliche Zielzahlen wurde verworfen: Er verschlechterte 300 × 200 von 11 auf 9 direkte Treffer. Die folgenden Werte gehören ausschließlich zur anschließend geprüften Rastergrenze.

## Freie Suche: gleicher Vergleichsmodus vor und nach der Suchänderung

Hier bleibt der produktive Modus `pallet-symmetry` auf beiden Seiten gleich; dies ist ein anderer Vorher-/Nachher-Vergleich als im Bericht vom 07.09. Gleiche Budgets und Eingaben ohne Sollstückzahl. Die neuen Sitzungen enthalten nicht vollständig geklärte operative Einstellungen; insbesondere ihre Winkelwerte sind eine dokumentierte Vergleichslücke.

| Fall                  | Oracle | Solverkandidaten | Direkte Grundfläche | Symmetrie | Gerichtete Winkel |   OPS\* |
| --------------------- | -----: | ---------------: | ------------------: | --------: | ----------------: | ------: |
| 201 × 139             |     87 |       339 → 1128 |               4 → 5 |     4 → 9 |             4 → 5 |   1 → 2 |
| 300 × 200             |     44 |        640 → 640 |             11 → 11 |   20 → 20 |           11 → 11 | 11 → 11 |
| 299 × 200             |     43 |      1267 → 1267 |               8 → 8 |   11 → 11 |             8 → 8 |   8 → 8 |
| 301 × 200             |     31 |      1233 → 1233 |             12 → 12 |   14 → 14 |           12 → 12 | 12 → 12 |
| 300 × 200 / Abstand 5 |     36 |      1094 → 1094 |             13 → 13 |   17 → 17 |           13 → 13 | 13 → 13 |
| 200 × 200             |      1 |        194 → 194 |               1 → 1 |     1 → 1 |             1 → 1 |   1 → 1 |
| 200 × 199             |    109 |      1481 → 1481 |               8 → 8 |   15 → 15 |             8 → 8 |   2 → 2 |
| 400 × 100             |     52 |        239 → 239 |             15 → 15 |   20 → 20 |           15 → 15 | 15 → 15 |
| 200 × 139             |     64 |        315 → 563 |               2 → 2 |     2 → 2 |             2 → 2 |   1 → 1 |
| 202 × 139             |     87 |       366 → 1096 |               4 → 5 |     5 → 7 |             4 → 5 |   1 → 2 |
| 201 × 139 (08.09.)    |     87 |       339 → 1128 |               4 → 5 |     4 → 9 |             0 → 0 |   0 → 0 |
| 203 × 139 (08.09.)    |     87 |       328 → 1113 |               4 → 5 |     4 → 6 |             0 → 0 |   0 → 0 |

Direkt bedeutet übereinstimmende Paketmittelpunkte und Rechteckgrundflächen ohne Transformation des Gesamtmusters innerhalb 0,500001 mm. Gerichtete Winkel unterscheiden 0/180 und 90/270. OPS\* verlangt gemeinsam Grundfläche, Winkel, Greifpartition, Zyklen und Griffreihenfolge; es umfasst keine vollständige TCP-/dx/dy-/Etikettenprüfung. Alle Suchen bleiben budgetbegrenzt und melden dies.

| Fall                  | Maximale Paketanzahl vorher → nachher | Fehlende direkte Oracle-Kandidaten | Zusätzliche Solverkandidaten ohne direkten Grundflächentreffer |
| --------------------- | ------------------------------------: | ---------------------------------: | -------------------------------------------------------------: |
| 201 × 139             |                               30 → 31 |                            83 → 82 |                                                     335 → 1123 |
| 300 × 200             |                               16 → 16 |                            33 → 33 |                                                      629 → 629 |
| 299 × 200             |                               16 → 16 |                            35 → 35 |                                                    1247 → 1247 |
| 301 × 200             |                               14 → 14 |                            19 → 19 |                                                    1213 → 1213 |
| 300 × 200 / Abstand 5 |                               12 → 12 |                            23 → 23 |                                                    1075 → 1075 |
| 200 × 200             |                               24 → 24 |                              0 → 0 |                                                      138 → 138 |
| 200 × 199             |                               24 → 24 |                          101 → 101 |                                                    1467 → 1467 |
| 400 × 100             |                               24 → 24 |                            37 → 37 |                                                      224 → 224 |
| 200 × 139             |                               33 → 33 |                            62 → 62 |                                                      313 → 560 |
| 202 × 139             |                               30 → 31 |                            83 → 82 |                                                     362 → 1091 |
| 201 × 139 (08.09.)    |                               30 → 31 |                            83 → 82 |                                                     335 → 1123 |
| 203 × 139 (08.09.)    |                               30 → 31 |                            83 → 82 |                                                     324 → 1108 |

Die bisherige Zehn-Fälle-Matrix verliert keine direkten Oracle-Treffer. Die Anzahl zusätzlicher Solverkandidaten steigt in betroffenen Fällen allerdings deutlich. Vollständige Kandidatenmengen und Rangfolgen stimmen weiterhin nicht überein. Die historischen Tabellen werden nicht rückwirkend überschrieben. Die externen Vergleichsdateien enthalten Paketanzahlverteilungen, Ordinaltreffer und operative Teilprüfungen.

## Export-Stabilisierung

Bei einem Export war die Datei nach erfolgreicher Existenzprüfung beim Lesen der Metadaten vorübergehend nicht vorhanden. `Wait-StableExport` behandelt ausschließlich diesen Dateiverschwund als erneutes Warten und setzt die Stabilitätsserie zurück. Auch eine zwischenzeitlich negative Existenzprüfung setzt die Serie zurück. Zugriffsfehler bleiben Fehler, das Zeitlimit bleibt erhalten. Es wird weder eine fehlende Datei akzeptiert noch eine Corpus-Prüfung gelockert. Der anschließend vollständige Kontrollcapture und der Nachbarfall wurden mit dieser Korrektur erstellt. Ein abgebrochener erster Export und seine nicht übereinstimmende Resume-Prüfung bleiben ausgeschlossen.

## Prüfungen und Grenzen

- `npm run typecheck` nach Änderungen erfolgreich; `npm run check` erfolgreich.
- Solver und Regionensuche: 86 Tests erfolgreich vor Ergänzung des neuen gezielten Tests.
- Regionensuche/Arbeitsbudget einschließlich neuem Test: 35 Tests erfolgreich. Der neue Test prüft exakt zwei Geometrien bei 70 Arbeitseinheiten und identische Ergebnisse bei umgekehrter Eingabereihenfolge; zuvor blieb nur eine der beiden Geometrien erhalten.
- Capture-Manifeste, Capture-Validierung und generierter Vergleich: 28 Tests erfolgreich.
- `scripts/multipack-oracle/Test-StableExport.ps1`: drei Prüfungen erfolgreich (Unterbrechung der Stabilitätsserie, Fehlerweitergabe, Zeitlimit).
- Determinismus bei Generatorreihenfolge und Progress-Batching bleibt durch die bestehenden Tests in beiden Äquivalenzmodi geprüft. Corpus-Gates unverändert; Captures und Analyseprogramme bleiben extern.

Nächster konkreter Ansatz: die zusätzlichen 180°-/270°-Entscheidungen nach dem Neustart mit kontrollierten Etiketten- und Orientierungseinstellungen erklären. Erst danach kann die neue Sitzung operative Regeln bestätigen. Unbekannte „Blöcke“, vollständige Rankingregeln und die Verteilung aller inneren Abstände bleiben offen. Richtung quer und eingeschränkte Rotationsfreigaben wurden nicht als wirksame Eingaben bestätigt.

## Ergänzung: Geometriegeneratoren und gerichtete Orientierung

Stand nach der vollständigen Wiederholungsprüfung vom 08.09.2026. Zusätzlich wurde 300 × 240 × 231 mm nach dem Neustart tatsächlich in MultiPack eingegeben und vollständig mit 24 Kandidaten exportiert. Damit liegen 752 validierte synthetische Kandidatenexporte aus 13 Läufen vor (11 verschiedene Maße-/Abstandskombinationen; der Referenzfall wurde wiederholt). Build und Hash entsprechen der oben genannten Referenz.

### Änderungen und Evidenz

- Asymmetrische Pinwheels werden auch ohne exakte Stückzahlvorgabe erzeugt. Bisher war dieser Pfad ausschließlich exakten Abfragen zugänglich.
- Kompakte Eckraster dürfen unterschiedlich hohe gegenüberliegende Bereiche haben. Der Rest bleibt als Abstand zwischen den Regionen; vorhandene Varianten mit verteilten inneren Abständen bleiben erhalten.
- Derselbe geometrische Aufbau wird entlang beider Achsen gesucht. Die Rücktransformation erhält die autorisierten Winkel; die gemeinsame Kandidatengrenze bleibt bestehen.
- Ein einzelnes im Projekt festgelegtes Etikettenfeld wird vom Projektadapter an den Solver weitergegeben; explizites `null` bleibt eine Abschaltung. Bei gleicher Entfernung gegenüberliegender Palettenkanten wird die positive Weltachse bevorzugt, sofern die entsprechende Drehung erlaubt ist.

Die Orientierung wurde getrennt auf bereits vorhandenen Oracle-Grundflächen geprüft: 201 × 139 und der Nachbar 203 × 139 jeweils 2.475/2.475 Paketwinkel und 87/87 vollständige Winkelmuster; 300 × 240 zusätzlich 277/277 Winkel und 24/24 Winkelmuster. Das ist ausdrücklich **keine Erzeugungsabdeckung von 87/87**. Die Zuordnung zur lokalen Etikettenseite „bottom“ ist ein aus Exporten geprüftes Modell; die App speichert diese Einstellung nicht im ROB. Die Kontrollaufnahme 300 × 240 bestätigt Gleichstände auf beiden Weltachsen.

Die Versuche mit nicht maximalen Reihenkombinationen sowie vollständig unabhängigen Eckspalten wurden verworfen: kein zusätzlicher direkter Referenztreffer, aber mehr Kandidaten beziehungsweise verdrängte Treffer unter gleichem Limit. Daraus wird keine MultiPack-Regel abgeleitet.

### Vollständige Matrix: Identitäten getrennt erhalten

Alle Läufe: EURO 1200 × 800 mm, Pakethöhe 231 mm, Einlauf längs, keine explizite Stückzahlbedingung im Solver, Kandidatengrenze 500 je Generator, unverändertes produktives Regionsbudget. „Direkt“ und „Sym.“ zählen Oracle-Kandidaten mit Grundflächentreffer innerhalb 0,500001 mm. Sym. darf eine Palettensymmetrie benötigen; diese Treffer werden nicht als direkte oder operative Gleichheit ausgegeben.

| Fall                  | Oracle | Direkt vorher → nachher | Sym. vorher → nachher | Solver nachher | Fehlend direkt | Zusätzliche Solveridentitäten |
| --------------------- | -----: | ----------------------: | --------------------: | -------------: | -------------: | ----------------------------: |
| 201 × 139             |     87 |                   5 → 8 |                9 → 12 |           2166 |             79 |                          2158 |
| 300 × 200             |     44 |                 14 → 14 |               20 → 20 |           1099 |             30 |                          1085 |
| 299 × 200             |     43 |                   8 → 8 |               11 → 11 |           1774 |             35 |                          1752 |
| 301 × 200             |     31 |                 13 → 13 |               14 → 14 |           1755 |             18 |                          1733 |
| 300 × 200 / Abstand 5 |     36 |                 15 → 15 |               17 → 17 |           1762 |             21 |                          1741 |
| 200 × 200             |      1 |                   1 → 1 |                 1 → 1 |            416 |              0 |                           288 |
| 200 × 199             |    109 |                  9 → 16 |               15 → 22 |           2244 |             93 |                          2219 |
| 400 × 100             |     52 |                 20 → 20 |               20 → 20 |            509 |             32 |                           489 |
| 200 × 139             |     64 |                   2 → 3 |                 2 → 3 |           1365 |             61 |                          1361 |
| 202 × 139             |     87 |                   5 → 8 |                7 → 10 |           2133 |             79 |                          2125 |
| 201 × 139 (Neustart)  |     87 |                   5 → 8 |                9 → 12 |           2166 |             79 |                          2158 |
| 203 × 139 (Neustart)  |     87 |                   5 → 8 |                 6 → 9 |           2150 |             79 |                          2142 |
| 300 × 240             |     24 |                   9 → 9 |               12 → 12 |           1211 |             15 |                          1202 |

Vorher ist der unmittelbar vorausgehende Stand mit dichter Suchplanung; für die drei neuen Sitzungsfälle ist die korrigierte Etikettenregel bereits in beiden Geometrievergleichen aktiv. Bei den zehn alten Läufen vergleicht die Tabelle Grundflächen mit dem vorherigen Stand ohne Etikettenvorgabe. Ihre alten 0°/90°-Winkel sind nicht operativ mit der neu gestarteten Sitzung gleichzusetzen. Im voreingestellten Symmetriemodus sinkt beim fast quadratischen Fall die direkte Repräsentantenabdeckung von 8 auf 7; der hier ausdrücklich getrennte Identitätsmodus steigt von 9 auf 16. Es gibt daher **keine behauptete Verbesserung jeder Dimension in jedem Modus**.

### Operative Teilprüfungen der neuen Sitzung

| Fall                 | Direkte Grundflächen ohne Koordinatenabweichung | Gerichtete Winkel | Greifpartition | Zyklen | Greifreihenfolge | Gemeinsam OPS\* |
| -------------------- | ----------------------------------------------: | ----------------: | -------------: | -----: | ---------------: | --------------: |
| 201 × 139 (Neustart) |                                               0 |                 8 |              3 |      8 |                3 |               3 |
| 203 × 139 (Neustart) |                                               0 |                 8 |              3 |      8 |                3 |               3 |
| 300 × 240            |                                               9 |                 9 |              9 |      9 |                9 |               9 |

Alle Werte zählen Oracle-Kandidaten mit mindestens einem entsprechenden direkten Match. OPS\* umfasst keine vollständigen Roboterposen. Die Kandidatenreihenfolge stimmt weiterhin nicht überein; Rang und Ordinal werden extern pro Treffer erfasst. Die stark abweichende Menge zusätzlicher Kandidaten verhindert bereits vollständige Reihenfolgeparität. Paketanzahlverteilungen sowie Bounding-Box- und Abstandsabweichungen verbleiben in den externen automatisierten Vergleichen.

### Grenzen und nächster Ansatz

Die historischen „31 eingegebenen Packstücke“ wurden nicht als zugängliches Stückzahleingabefeld bestätigt. Bestätigt sind 87 Referenzergebnisse mit 24–31 Paketen, keine Regel „exakt“ oder „maximal“. Abstand und Mehrfachgreifen wurden in der UI kontrolliert; Abstand steht nicht im ROB. Quer-Einlauf und eingeschränkte Rotationsfreigaben wurden nicht als wirksam einstellbare Diagnosepaare bestätigt. „Blöcke“ bleibt unbekannt.

Nächster konkreter Ansatz: die verschachtelten Restregionen und ihre Abstandsverteilung getrennt von der quantisierten ROB-Greifdarstellung untersuchen. Insbesondere müssen zusätzliche Geometrien unter festem Familienlimit erhalten bleiben, bevor ein weiterer Generator produktiv übernommen wird. Vollständige MultiPack-Parität ist weiterhin nicht erreicht.

### Abschlie�ende Pr�fungen dieser Erg�nzung

- `npm run typecheck` nach jeder �nderung erfolgreich; `npm run check` erfolgreich.
- Gesamtsuite mit `npx vitest run --maxWorkers=4`: **781 bestanden, 2 opt-in Corpus-Tests �bersprungen**, 109 Testdateien bestanden, eine opt-in Datei �bersprungen. Keine unbehandelten Fehler.
- Der vorherige unbeschr�nkte Gesamtlauf hatte ebenfalls 781 bestandene Tests, aber einen Vitest-RPC-Timeout; er wird nicht als erfolgreicher Lauf gewertet. Die begrenzte Wiederholung behebt den Lauf ohne ge�nderte Erwartungen oder erh�htes Testzeitlimit.
- Zus�tzliche konstruierte Geometrietests pr�fen exakt 25 Pakete, jeden Mittelpunkt, jeden Winkel, positiven Abstand und den transponierten Aufbau. Bestehende Tests pr�fen Generatorreihenfolge und Progress-Batching in beiden �quivalenzmodi.
- `git diff --check` erfolgreich. Rohcapturen und externe Analyseprogramme wurden nicht ins Repository �bernommen.
