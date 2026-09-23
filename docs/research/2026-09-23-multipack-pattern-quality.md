# Weniger überflüssige Muster – 23.09.2026

Die Fortsetzung der [Streifen-Erweiterung](2026-09-23-multipack-stepped-strips.md)
reduziert die ausgegebene Kandidatenmenge der 16 Kartonfälle von **35.485 auf
26.481**: **9.004 Kandidaten beziehungsweise 25,4 % weniger**. Alle **133 direkten
Oracle-Treffer**, alle **91 OPS\*-Treffer** und sämtliche Maximalbelegungen bleiben
erhalten. Die vier zusätzlichen Kontrollfälle verlieren ebenfalls keinen
bisherigen direkten oder operativen Treffer.

## Auswahlregeln

- Versetzte Streifen erhalten für jede Querbandanordnung nur das größte
  zulässige Basisraster. Der Generator sucht absteigend nach der Reihenzahl.
  Begrenzen Stückzahl oder Platz die volle Höhe, sucht er die größte noch
  zulässige kleinere Basis. Er erzeugt keine weiteren verkürzten Varianten
  derselben Anordnung. Eine feste Stückzahl bleibt erreichbar; eine Höhe ohne
  Platz für mindestens eine Basisreihe erzeugt keinen Entwurf.
- Bei freier Stückzahlsuche werden schwächer belegte Alternativen aussortiert,
  deren belegtes Rechteck einen vollständigen zusätzlichen Randstreifen frei
  lässt. Die Schwelle ist die **lange Kartonkante plus Mindestabstand**, keine
  pauschale Auslastungsquote. Damit reicht Platz für eine anders gedrehte
  Restspalte allein nicht zum Ausschluss eines ansonsten gefüllten Rasters.
- Ebenfalls entfallen schwächere Alternativen mit einem durchgehenden freien
  Korridor zwischen Teilblöcken, in den ein freigegebener Karton einschließlich
  beider Mindestabstände passt. Rotationsfreigaben und das Verbot gemischter
  Orientierungen werden berücksichtigt.
- Die beiden geometrischen Filter gelten nur ohne ausdrücklich angegebene
  Mindest- oder Höchststückzahl. Sie behalten die beste tatsächlich gefundene
  Stückzahl auch bei begrenzter Suche. Kleine Restabstände und eingeschlossene
  Pinwheel-Kerne allein führen zu keinem Ausschluss.

Die geometrische Auswahl erfolgt nach Validierung und Zusammenfassung gleicher
Kandidaten, vor der Rangvergabe. Ausgeschlossene Varianten erhalten den Grund
`sparse-layout`; `sparse-layouts-omitted` meldet deren Anzahl. Sie sind gültige,
aber für die freie Suche unproduktive Alternativen, keine Geometriefehler.
Die Statistik gültiger Entwürfe bleibt deshalb von der Ergebnisanzahl getrennt.

Ein probeweise geprüfter allgemeiner Filter „es passt irgendwo noch ein Karton“
wurde nicht übernommen: Er entfernte auch belegte MultiPack-Muster. Die Auswahl
enthält keine fallbezogenen Listen und verändert keine importierten ROB-Pläne.

## Erneuter Referenzvergleich

Verglichen wurden alle 20 vorhandenen Captures mit erneut geprüften Manifesten;
es gab keinen neuen Desktop-Capture. Build, Eingaben, Arbeitsbudgets und
Vergleichstoleranz entsprechen dem verlinkten Vorgängerbericht. Insbesondere:
`candidateEquivalence: identity`, 500 Kandidaten je Familie, produktives
Regionsbudget und freie Stückzahlsuche. Die Zahlen zählen gerichtete
Solveridentitäten, nicht ausschließlich verschiedene sichtbare Grundflächen.

Die externen Ergebnisdateien heißen
`comparison-production-quality-20260923.json`. Historische Vergleiche bleiben
unverändert. Rohdateien und Analyseprogramme bleiben außerhalb des Repositorys.

| Karton L × B | Kandidaten vorher | Kandidaten nachher | Direkte Treffer vorher / nachher |
| ------------ | ----------------: | -----------------: | -------------------------------: |
| 135 × 91     |              2965 |               2027 |                            2 / 2 |
| 147 × 104    |              2695 |               1838 |                          14 / 14 |
| 148 × 148    |              1610 |               1058 |                            1 / 1 |
| 154 × 107    |              2726 |               1862 |                            4 / 4 |
| 157 × 106    |              2623 |               1727 |                          15 / 15 |
| 157 × 110    |              2596 |               1734 |                            7 / 7 |
| 158 × 109    |              2721 |               1854 |                            3 / 3 |
| 158 × 82     |              2997 |               2170 |                          10 / 10 |
| 172 × 130    |              2472 |               1914 |                            2 / 2 |
| 177 × 123    |              2168 |               1528 |                            5 / 5 |
| 230 × 157    |              1387 |               1207 |                            8 / 8 |
| 245 × 98     |              1788 |               1180 |                          14 / 14 |
| 249 × 170    |              1710 |               1576 |                            8 / 8 |
| 250 × 165    |              1538 |               1380 |                            8 / 8 |
| 308 × 220    |              1995 |               1978 |                          26 / 26 |
| 380 × 250    |              1494 |               1448 |                            6 / 6 |

Kontrollfälle: 201 × 139 mm **2930 → 2487** (9 direkte Treffer), 203 × 139 mm
**2914 → 2477** (9), 300 × 240 mm **1305 → 1291** (13), 146 × 104 mm
**2779 → 1981** (11). Über alle 20 Fälle zusammen: **45.413 → 34.717**
Kandidaten, unverändert **175 direkte Treffer** und **111 OPS\*-Treffer**.
Die Prüfung vergleicht die einzelnen getroffenen Exportordinale, nicht nur
gleiche Summen. OPS\* bezeichnet weiterhin den gemeinsamen Treffer von
Grundfläche, gerichteten Winkeln, Greifpartition, Zykluszahl und Griffreihenfolge;
TCP-Posen sind darin nicht enthalten.

## Prüfungen und verbleibende Grenzen

- `npm run typecheck` nach den Änderungen: erfolgreich.
- `npm run check`: erfolgreich.
- `npx vitest run --maxWorkers=1`: **803 bestanden, zwei opt-in Tests
  übersprungen**, 112 Testdateien bestanden, eine übersprungen.
- Neue Verhaltenstests prüfen ganze Freistreifen, erlaubte Restabstände und
  eingeschlossene Kerne, beidseitige Abstände im Korridor, Rotations- und
  Mischungsregeln, verschobene und vertauschte Achsen, feste Stückzahlen und
  Bereiche, Erhalt des besten begrenzten Suchergebnisses, Abbruch und
  Reihenfolgeunabhängigkeit. Der Streifentest prüft volle und durch Stückzahlen
  begrenzte Basisraster sowie zu kleine Höhen. Die bestehenden Solvertests
  prüfen zusätzlich Generatorreihenfolge und Progress-Batches in beiden
  Äquivalenzmodi.

Die Regeln entfernen offensichtliche überflüssige Freistreifen; sie beweisen
keine Stapelstabilität oder vollständige Roboterfreigabe. Weiterhin fehlen
**935 von 1068** direkten Oracle-Mustern. Zusätzliche Solveridentitäten ohne
direkte Oracle-Grundfläche sinken von **34.675 auf 25.671**. Anzahl, Reihenfolge
und sämtliche Bedienungsfälle sind weiterhin nicht identisch mit MultiPack.
Besonders die zahlreichen Varianten gleicher dicht belegter Grundflächen und
weitere Topologie-/Abstandsvarianten benötigen noch eine belegbare Auswahlregel.
