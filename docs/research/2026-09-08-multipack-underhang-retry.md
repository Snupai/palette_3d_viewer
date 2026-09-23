# Wiederholung mit vorgegebenem Unterhang – 08.09.2026

Die vier vom Nutzer korrigierten Eingaben wurden in der isolierten Desktop-Kopie
von MULTIPACK für Roboter 2.1.315.25 neu eingegeben, visuell kontrolliert und
vollständig exportiert. Der eigenständige Solver wurde unverändert mit denselben
Nutzflächen ausgeführt. Diese Messung ersetzt keine früheren Messungen mit
anderen Eingaben und enthält keine neue Solver-Implementierung.

## Eingaben und Ergebnisse

Palette: 1200 × 800 mm. Der erste Unterhangwert betrifft die Länge, der zweite
die Breite. Es sind signierte Änderungen des **Gesamtmaßes**, keine Werte pro
Seite. Die verkleinerte Nutzfläche bleibt auf der physischen Palette zentriert.
Paketabstand 0 mm, Mehrfachgreifen aktiv, Einlauf längs, Palettierrichtung x−/y+,
schmalzgripper (1), Turm und gleiche Lagen wie im vorherigen Lauf.

| Paket L × B × H, mm | Unterhang L / B, mm | Nutzfläche, mm | Desktop-Muster | Direkte Grundflächentreffer | Max. Pakete Desktop / Solver | Solver-Kandidaten |
| ------------------- | ------------------- | -------------- | -------------: | --------------------------: | ---------------------------: | ----------------: |
| 135 × 91 × 196      | −17 / −34           | 1183 × 766     |             56 |                           2 |                      73 / 73 |              2312 |
| 147 × 104 × 139     | −24 / −29           | 1176 × 771     |             65 |                           3 |                      59 / 59 |              2041 |
| 158 × 78 × 165      | −52 / −10           | 1148 × 790     |            112 |                           2 |                      70 / 70 |              2481 |
| 177 × 123 × 143     | 0 / −23             | 1200 × 777     |             71 |                           9 |                      42 / 42 |              2377 |

**16 von 304 Desktop-Grundflächen** werden direkt nachgebildet. 288 fehlen.
Gleiche Maximalbelegung in allen vier Fällen bedeutet daher weiterhin keine
vollständige Übereinstimmung der Musterlisten. Beim dritten Fall wurden
ausdrücklich 78 mm Paketbreite verwendet.

Auch die Muster mit maximaler Paketanzahl sind nicht vollständig abgedeckt:
135 × 91 erreicht 0 von 11 Desktop-Maximalmustern, 147 × 104 erreicht 0 von 5,
158 × 78 erreicht 2 von 111 und 177 × 123 erreicht 1 von 4. Der Solver kann
also dieselbe maximale Anzahl mit einer anderen Geometrie erreichen.

Treffer nach Desktop-Exportordinal:

- 135 × 91: 50, 52.
- 147 × 104: 55, 57, 63.
- 158 × 78: 1, 2.
- 177 × 123: 1, 5, 8, 20, 21, 46, 49, 66, 67.

## Prüfmethode

Alle vier Capture-Manifeste bestätigen die vollständige erwartete Exportzahl.
Paketmaße, Höhe, Palettenmaße und Einlaufrichtung sind exportverifiziert.
Unterhang und Mindestabstand sind UI-Evidenz, da das ROB-Format diese Eingaben
nicht eigenständig vollständig festhält. Alle materialisierten Lagen jedes
Exports haben untereinander dieselbe physische Grundfläche; der Vergleich der
ersten Lage lässt somit in diesen Captures keine zusätzliche Lagengeometrie aus.

Verglichen wurden vollständige Mengen physischer Paket-Rechtecke, mit
0,500001 mm Positionstoleranz wegen der ganzzahligen ROB-Ausgabe, ohne
nachträgliches Verschieben, Drehen oder Spiegeln der Gesamtfläche. Gerichtete
Etikettenwinkel, Greifpartitionen, Griffreihenfolge und Ranking wurden nicht
als Bestandteil dieser Grundflächentreffer gewertet.

Solver-Einstellungen: `candidateEquivalence: "identity"`,
`PRODUCTION_REGION_SEARCH_BUDGET`, 500 Kandidaten je Generator,
Rotationen 0/90/180/270 Grad, `axis-ends`, Etikettenseite `bottom`,
`provisionalPackagesPerCycle = floor(450 / Paketlänge)`.
Die physischen Palettengrenzen bleiben 0…1200 / 0…800 mm. Nur `envelopeMm`
wird anhand des Gesamt-Unterhangs zentriert verkleinert. Zum Beispiel ergibt
−17/−34 die Grenzen X = 8,5…1191,5 und Y = 17…783 mm.
Die gemeldeten Suchbudgetgrenzen bleiben aktiv; dieser Lauf ist keine
unbegrenzte Enumeration. Die Kandidatenzahlen beziehen sich auf den
Identitätsmodus, nicht auf die zusammengefassten Karten in der Oberfläche.

Die Desktop-Kopie entspricht demselben EXE-Hash wie im
[vorherigen Bericht](2026-09-08-multipack-interlocked-blocks.md).
Capture-Manifeste, synthetische Exporte, Eingabe-Screenshots und
Vergleichsprogramme verbleiben außerhalb des Repositorys. Keine Kundendateien
oder Rohkoordinaten wurden in diesen Bericht übernommen.

Verifikation: TypeScript-Typecheck erfolgreich. In diesem Wiederholungslauf
wurde nur der Bericht ergänzt; die Solver-Logik und ihre Tests blieben
unverändert. Deshalb wurde die gesamte Testsuite nicht erneut ausgeführt.
