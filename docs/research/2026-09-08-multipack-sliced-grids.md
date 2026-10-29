# Eingesetzte Querstreifen und gegenüberliegende Randblöcke

Der eigenständige Solver erzeugt zusätzlich zwei Musterfamilien:

- `slice-grid` setzt einen gedrehten Rasterstreifen an jede Naht zwischen den
  normalen Reihen, einschließlich beider Außenkanten.
- `paired-grid` kombiniert gegenüberliegende gedrehte Randblöcke mit normalen
  Spalten. Überdecken sich die Spaltenbereiche der Randblöcke, wird der mittlere
  Rasterbereich entsprechend kürzer. Kompakte und verteilte Randblöcke sowie
  unterschiedliche Ausrichtungen der verbleibenden Reihen werden geprüft.

Die Konstruktionen verwenden die Eingabemaße, keine gespeicherten ROB-Muster.
Restabstände können kontinuierlich, über gerundete Positionen oder mit einem
abgerundeten Verteilungsschritt verteilt werden. Eine Rundung wird verworfen,
wenn sie den verfügbaren Bereich oder den Mindestabstand verletzen würde.
Greifgruppen werden entlang ihrer tatsächlichen Greifachse berücksichtigt.

Die bestehenden Kandidaten- und Arbeitsbudgets bleiben wirksam. Es handelt
sich weiterhin um eine begrenzte Mustersuche, **nicht um die vollständige
Nachbildung aller Multipack-Muster**.

## Erneuter Vergleich derselben 304 synthetischen Desktop-Exporte

Eingaben und Messmethode entsprechen dem
[Unterhang-Vergleich](2026-09-08-multipack-underhang-retry.md):
1200 × 800 mm physische Palette, Gesamt-Unterhang zentriert, Abstand 0,
Identitätsmodus, 500 Kandidaten pro Generator, Produktionsbudget für die
Regionensuche. Der direkte Rechteckvergleich verwendet unverändert 0,500001 mm
Positionstoleranz und keine nachträgliche Verschiebung, Drehung oder Spiegelung.

| Karton L × B, mm | Unterhang L / B, mm | Desktop-Muster | Treffer vorher | Treffer jetzt | Solver-Kandidaten jetzt | Maximalbelegung Desktop / Solver |
| ---------------- | ------------------- | -------------: | -------------: | ------------: | ----------------------: | -------------------------------: |
| 135 × 91         | −17 / −34           |             56 |              2 |            13 |                    3310 |                          73 / 73 |
| 147 × 104        | −24 / −29           |             65 |              3 |            21 |                    3037 |                          59 / 59 |
| 158 × 78         | −52 / −10           |            112 |              2 |            27 |                    3475 |                          70 / 70 |
| 177 × 123        | 0 / −23             |             71 |              9 |            26 |                    3376 |                          42 / 42 |

Damit steigt die direkte Abdeckung von 16 auf **87 von 304** Mustern.
**217 Muster fehlen weiterhin.** Alle bisherigen direkten Treffer bleiben
enthalten. Gleiche Stückzahlen allein werden nicht als Mustertreffer gezählt.
Die Gleichheit von Etikettenwinkeln, Greifpartitionen, Reihenfolge und Ranking
ist mit dieser Grundflächenmessung nicht nachgewiesen.

## Die 18 zusätzlich bereitgestellten Fotos

Die Fotos enthalten 15 unterschiedliche Kombinationen aus Kartongrundfläche,
Blockgrundfläche und Kartonanzahl je Lage. Für alle 15 findet die eigenständige
Generierung eine gültige Anordnung mit exakt diesen Zahlen und Außenmaßen.
`referenceLayerDimensions.test.ts` hält diese Beobachtungen als Tests fest.
Produktinformationen und die Fotos selbst wurden nicht übernommen.

Dieser Test stellt die beobachteten Blockmaße als verfügbaren Bereich ein;
er behauptet weder, dass diese Maße die ursprünglichen Unterhang-Eingaben waren,
noch dass alle einzelnen Kartonpositionen der Fotos identisch rekonstruiert sind.
Die Fotos enthalten keine vollständigen Desktop-Kandidatenlisten.

Bei den Zerstäuber-Kartons nennen die Fotos **158 × 82 × 165 mm Außenmaße**
und 154 × 78 × 157 mm Innenmaße. Der zusätzliche Fototest verwendet die
Außenmaße: 70 Kartons in einem Raster von 14 × 5 bei 1148 × 790 mm.
Der zuvor ausdrücklich angeforderte 158 × 78 × 165-mm-Vergleich bleibt als
separater Fall erhalten.

## Prüfung

Die neuen Konstruktionstests prüfen konkrete Koordinaten aller fünf möglichen
Querstreifenpositionen eines kleinen synthetischen Beispiels, einen verkürzten
mittleren Bereich zwischen Randblöcken, abgerundete Verteilungsschritte,
positive Mindestabstände, Rotationsreihenfolge, Abbruch und Arbeitsgrenzen.
Die 20 neuen Tests, ESLint und der Typecheck sind erfolgreich. Im Gesamtlauf
bestanden zunächst 800 Tests; fünf Solver-Tests meldeten veraltete
Bestandszahlen beziehungsweise Zeitüberschreitungen, zwei Corpus-Tests waren
übersprungen. Nach Aktualisierung der exakten Bestandszahlen und Verkleinerung
unnötiger Testberechnungen bestehen alle 51 Tests der Solver-Datei. Die fünf
zuvor fehlgeschlagenen Tests wurden zusätzlich direkt mit Node ausgeführt:
fünf bestanden, Prozess-Exitcode 0. Zusammen mit den separat ausgeführten
15 Fotomaß-Tests sind damit 820 aktive Tests erfolgreich geprüft. Es gab
keinen erneuten vollständigen Gesamtlauf nach den Anpassungen der Tests.

Der zweite JSON-Lauf der Solver-Datei meldete zwar 51 bestandene Tests und
`success: true`, sein Bun-Starter lieferte aber Exitcode 1; deshalb erfolgte
der zusätzliche direkte Node-Lauf. Die Test-Zeitgrenzen wurden nicht erhöht.
