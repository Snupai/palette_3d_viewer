# Versetzte Streifen und Restabstände – 23.09.2026

Dieser Bericht dokumentiert den Stand vor der anschließenden
[Auswahl gegen überflüssige Muster](2026-09-23-multipack-pattern-quality.md).
Die dortige Reduktion erhält die hier erreichte Referenzabdeckung.

Fortsetzung der [Crossed-Strip-Erweiterung](2026-09-08-multipack-crossed-strips.md).
Die 16 Kartonfälle erreichen jetzt sämtlich dieselbe Maximalbelegung wie ihre
MultiPack-Exporte. Die direkte Musterabdeckung steigt von **109 auf 133 von
1068**. **Kein bisheriger direkter Oracle-Treffer geht verloren.** Vollständige
Solverparität ist damit weiterhin nicht erreicht.

## Evidenz und Vergleich

Verwendet wurden die vorhandenen, erneut mit dem Capture-Validator geprüften
Exporte vom 08.09.2026. Es wurde kein neuer Desktop-Capture erstellt.
Referenzbuild: **2.1.315.25**, SHA-256
`629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff`.

Vergleich wie zuvor: EURO 1200 × 800 mm, Abstand 0, Einlauf längs,
Etikettenmodell „bottom“, Winkel 0/90/180/270, `axis-ends`, Greifkapazität
`floor(450 / Paketlänge)`, 500 Kandidaten je Familie, unverändertes produktives
Regionsbudget, `candidateEquivalence: identity`, keine Stückzahlbedingung.
Direkte Treffer benötigen keine Palettentransformation; die Toleranz beträgt
0,500001 mm je Achse. Verglichen wird jeweils das erste exportierte Lagenmuster.
OPS\* verlangt einen gemeinsamen Treffer für Grundfläche, gerichtete Winkel,
Greifpartition, Zykluszahl und Griffreihenfolge, keine vollständigen TCP-Posen.
Die Grenzen der ursprünglichen Eingabeverifikation gelten weiterhin.

Die historischen Vergleichsdateien bleiben unverändert. Die neuen externen
Dateien heißen `comparison-stepped-spacing-final-20260923.json` und enthalten
auch Verteilungen, einzelne Ordinaltreffer und operative Teilprüfungen.
Rohdateien und Analyseprogramme bleiben außerhalb des Repositorys.

## Änderungen

- `stepped-strip` erzeugt zwei versetzte Querbänder über einem Basisraster und
  einen seitlichen Reststreifen. Maße und Stückzahlen werden aus den Eingaben
  berechnet. Beide Achsen und vier Spiegelstellungen werden unabhängig vom
  bisherigen Symmetriebudget erzeugt. Bei 177 × 123 mm trifft dieser Aufbau das
  erste 43er-Oracle-Muster einschließlich gerichteter Winkel, Greifpartition und
  28 Zyklen. Die Griffreihenfolge stimmt bei diesem Treffer noch nicht überein;
  das zweite 43er-Muster fehlt weiterhin.
- Crossed Strips behalten für eine einzelne Reihe im höheren Restbereich neben
  der zentrierten auch beide randbündigen Positionen. Identische Varianten ohne
  solchen Rest werden nicht mehrfach materialisiert.
- Verteilte Aufnahmegruppen werden bei `axis-ends` vor dem Zusammenrücken
  ausgeglichen: sieben Pakete bei Kapazität drei ergeben beispielsweise 2+2+3.
  Das erklärt zwei zusätzliche 61er-Treffer bei 147 × 104 mm. Die gemeinsame
  Gruppierungsregel für bereits kompakte Reihen bleibt unverändert.
- Innere Positionen quer zur Greifachse werden auf ganze Millimeter im
  Palettenrahmen abgerundet. Randpositionen bleiben erhalten; würde die Rundung
  den Mindestabstand verletzen, bleibt die kontinuierliche Verteilung bestehen.

Das sind anhand von Exporten geprüfte Konstruktionsregeln, keine Kenntnis des
internen MultiPack-Quellcodes. Die neue Familie hat höchstens 10.000
Descriptor-Arbeitsschritte, 100.000 materialisierte Paketpositionen und das
konfigurierte Familienlimit. Abbruch, Rotationsfreigaben, Stückzahlgrenzen,
Rechteckblockvorgaben und abschließende Geometrievalidierung bleiben wirksam.

## Vollständige Matrix der 16 Kartonfälle

| Karton L × B × H | Oracle | Direkt vorher → nachher | Greifpartition nachher | OPS\* vorher → nachher | Max. Oracle / Solver nachher | Solveridentitäten vorher → nachher |
| ---------------- | -----: | ----------------------: | ---------------------: | ---------------------: | ---------------------------: | ---------------------------------: |
| 147 × 104 × 139  |     65 |                  9 → 14 |                      6 |                  2 → 2 |                      61 / 61 |                        2147 → 2695 |
| 158 × 82 × 165   |     68 |                  5 → 10 |                     10 |                  2 → 3 |                      71 / 71 |                        2497 → 2997 |
| 172 × 130 × 104  |     88 |                   2 → 2 |                      2 |                  1 → 1 |                      40 / 40 |                        1972 → 2472 |
| 148 × 148 × 122  |      1 |                   1 → 1 |                      1 |                  1 → 1 |                      40 / 40 |                        1610 → 1610 |
| 250 × 165 × 164  |     66 |                   7 → 8 |                      8 |                  7 → 8 |                      21 / 21 |                        1249 → 1538 |
| 380 × 250 × 200  |     17 |                   6 → 6 |                      6 |                  6 → 6 |                        9 / 9 |                        1456 → 1494 |
| 245 × 98 × 174   |     65 |                 12 → 14 |                     14 |                12 → 14 |                      38 / 38 |                        1306 → 1788 |
| 157 × 110 × 175  |     45 |                   7 → 7 |                      7 |                  2 → 2 |                      54 / 54 |                        2078 → 2596 |
| 249 × 170 × 136  |     68 |                   7 → 8 |                      8 |                  7 → 8 |                      21 / 21 |                        1442 → 1710 |
| 157 × 106 × 150  |    109 |                 15 → 15 |                     15 |                  6 → 6 |                      55 / 55 |                        2135 → 2623 |
| 308 × 220 × 188  |     36 |                 17 → 26 |                     26 |                17 → 26 |                      12 / 12 |                        1859 → 1995 |
| 135 × 91 × 196   |    112 |                   2 → 2 |                      2 |                  1 → 1 |                      73 / 73 |                        2475 → 2965 |
| 154 × 107 × 171  |     94 |                   4 → 4 |                      4 |                  2 → 2 |                      57 / 57 |                        2215 → 2726 |
| 177 × 123 × 143  |    100 |                   4 → 5 |                      5 |                  1 → 1 |                      43 / 43 |                        1687 → 2168 |
| 230 × 157 × 58   |     72 |                   8 → 8 |                      8 |                  8 → 8 |                      25 / 25 |                        1106 → 1387 |
| 158 × 109 × 135  |     62 |                   3 → 3 |                      3 |                  2 → 2 |                      55 / 55 |                        2215 → 2721 |

Gesamt: direkte Treffer **109 → 133**, passende Greifpartitionen **103 → 125**,
OPS\* **77 → 91**. Das vorherige Maximum bei 177 × 123 mm war 42.
Bei 308 × 220 mm sind alle 26 direkten Treffer ohne Koordinatenabweichung.

## Bereits vorhandene Kontrollfälle

| Karton          | Oracle | Direkt vorher → nachher | OPS\* vorher → nachher | Verlorene direkte Treffer |
| --------------- | -----: | ----------------------: | ---------------------: | ------------------------: |
| 201 × 139 × 231 |     87 |                   8 → 9 |                  3 → 3 |                         0 |
| 203 × 139 × 231 |     87 |                   8 → 9 |                  3 → 3 |                         0 |
| 300 × 240 × 231 |     24 |                 12 → 13 |                12 → 13 |                         0 |
| 146 × 104 × 139 |     65 |                  8 → 11 |                  1 → 1 |                         0 |

Auch hier bleiben die Maximalbelegungen unverändert und entsprechen dem Oracle
(31, 31, 13 beziehungsweise 61 Pakete). Diese Exporte wurden bereits vor dieser
Änderung aufgenommen; sie sind keine frischen Desktop-Beobachtungen.

## Grenzen und nächste Arbeit

**935 der 1068 direkten Oracle-Muster fehlen weiterhin.** Die Anzahl zusätzlicher
Solveridentitäten ohne direkte Oracle-Grundfläche steigt von **28.663 auf
34.675**. Höhere geometrische Abdeckung bedeutet hier deshalb keine bessere
Übereinstimmung des gesamten Kandidateninventars. Vollständige Reihenfolge,
Griffreihenfolge, weitere verschachtelte Restbereiche und die Bedeutung von
„Blöcke“ bleiben offen. Die Vergleiche sind weiterhin suchbudgetbegrenzt.

Nächste konkrete Untersuchungen: das zweite 43er-Muster in seine verschachtelten
Teilbereiche zerlegen; die vielen ungetroffenen 135 × 91-mm-Muster erklären;
die Auswahl zusätzlicher, schwächer belegter Varianten anhand der vollständigen
Oracle-Inventare einschränken. Keine fallbezogenen Ergebnislisten oder pauschalen
Belegungsgrenzen aus einem Einzelbeispiel in den Solver übernehmen.

## Prüfungen

- `npm run typecheck`: erfolgreich nach den Änderungen.
- `npm run check`: erfolgreich.
- `npx vitest run --maxWorkers=1`: **798 bestanden, zwei opt-in Tests
  übersprungen**, 111 Testdateien bestanden, eine übersprungen; keine
  unbehandelten Fehler.
- Fünf neue Verhaltenstests prüfen ein unabhängig konstruiertes 43er-Muster mit
  allen Positionen, positive Abstände, beide Achsen, Gegenwinkel, Sortierung der
  Rotationsfreigaben, Arbeits- und Familiengrenzen, Abbruch, ausgeglichene
  Aufnahmegruppen und drei Positionen einzelner Restreihen.
- Die bestehenden Determinismustests stellen jetzt beide neuen Streifenfamilien
  ausdrücklich an entgegengesetzte Stellen der Generatorreihenfolge und prüfen
  beide Äquivalenzmodi sowie unterschiedliche Progress-Batches.
- Die ursprüngliche Sieben-Muster-Inventur bleibt exakt erhalten; die 58
  Crossed-Strip-Kandidaten dieses Falls werden separat geprüft.
- Corpus-Schutz und importierte ROB-Originaltexte wurden nicht geändert.
