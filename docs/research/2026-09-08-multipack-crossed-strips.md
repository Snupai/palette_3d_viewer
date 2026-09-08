# Erweiterung der geometrischen Abdeckung – 08.09.2026

Dieser Lauf erweitert die Mustererzeugung nach dem [16-Karton-Vergleich](2026-09-08-multipack-user-cartons.md). Die vorige Gruppierungsänderung hatte keine zusätzlichen Grundflächen geliefert. Hier wird eine neue geometrische Familie geprüft, nicht eine neue Auswertung derselben Kandidatenzahl.

## Konstruktion und Grenzen

- `crossed-strip`: Ein durchgehendes Rasterband grenzt an quer verlaufende gemischte Streifen. Beide Seiten des Rasterbands, beide Achsen und alle Aufteilungen der seitlichen Streifen werden enumeriert. Die gemeinsame Außenbreite ist das Maximum beider Teilbreiten, nicht zwingend die Breite des durchgehenden Rasters.
- Die Streifen verwenden maximal passende Reihen; dadurch werden schmale Restbereiche auch mit größerem innerem Abstand ausgefüllt. Die Begrenzung sauberer Rechteckblöcke auf 15 Prozent beziehungsweise 25 mm gilt weiterhin für diese Rechteckblöcke und wird nicht abgeschwächt.
- Auf der Greifachse werden zunächst gleichmäßig verteilte Einzelpositionen bestimmt. Eine Greifgruppe wird um deren gemeinsamen Mittelpunkt kompakt zusammengerückt; der Mittelpunkt wird im Palettenkoordinatensystem auf ganze Millimeter abgerundet. Dies ist ein gegen die Exporte geprüftes Erzeugungsmodell, keine Behauptung über den internen MultiPack-Code. Die abschließende Zentrierung und Geometrievalidierung bleiben aktiv.
- Positive Mindestabstände bleiben erhalten. Ungültige Überlappungen oder nicht-endliche Positionen werden nicht zugelassen. Erzwungene reine Rechteckblöcke verwenden weiterhin ihre bisherigen Generatoren.
- Eigenes Familienlimit, 10.000 Descriptor-Versuche und höchstens 100.000 materialisierte Paketpositionen begrenzen die neue Suche. Beide Achsen und Seiten werden in dieser Familie direkt erzeugt; sie verbraucht deshalb keine Plätze des bisherigen Symmetrie-Budgets. Tests prüfen Generatorreihenfolge und Progress-Batching.

## Vorher / nachher: vorhandene 16 Fälle

Identitätsmodus, 500 Kandidaten je Generator, unverändertes produktives Regionsbudget, EURO 1200 × 800 mm, Abstand 0, Einlauf längs, dieselben Profil- und Etikettenannahmen wie im vorigen Bericht. Die 1068 geprüften Exporte stammen aus Build 2.1.315.25 mit SHA-256 `629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff`. Direkte Grundflächentreffer verwenden 0,500001 mm Toleranz und keine Palettentransformation. OPS* umfasst gemeinsam Geometrie, gerichtete Winkel, Greifpartition, Zykluszahl und Griffreihenfolge, keine vollständigen TCP-Posen.

| Karton | Oracle | Direkte Grundflächen | Symmetriegrundflächen | Greifpartition | OPS* | Max. Kartons Oracle / Solver vorher / nachher |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 147 × 104 × 139 | 65 | 4 → 9 | 4 → 9 | 3 → 3 | 2 → 2 | 61 / 60 / 61 |
| 158 × 82 × 165 | 68 | 4 → 5 | 4 → 5 | 4 → 5 | 2 → 2 | 71 / 70 / 71 |
| 172 × 130 × 104 | 88 | 2 → 2 | 2 → 2 | 2 → 2 | 1 → 1 | 40 / 40 / 40 |
| 148 × 148 × 122 | 1 | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 | 40 / 40 / 40 |
| 250 × 165 × 164 | 66 | 7 → 7 | 7 → 7 | 7 → 7 | 7 → 7 | 21 / 21 / 21 |
| 380 × 250 × 200 | 17 | 6 → 6 | 9 → 9 | 6 → 6 | 6 → 6 | 9 / 9 / 9 |
| 245 × 98 × 174 | 65 | 8 → 12 | 8 → 12 | 8 → 12 | 8 → 12 | 38 / 38 / 38 |
| 157 × 110 × 175 | 45 | 7 → 7 | 7 → 7 | 7 → 7 | 2 → 2 | 54 / 54 / 54 |
| 249 × 170 × 136 | 68 | 7 → 7 | 10 → 10 | 7 → 7 | 7 → 7 | 21 / 21 / 21 |
| 157 × 106 × 150 | 109 | 3 → 15 | 3 → 15 | 3 → 15 | 2 → 6 | 55 / 55 / 55 |
| 308 × 220 × 188 | 36 | 15 → 17 | 18 → 19 | 15 → 17 | 15 → 17 | 12 / 12 / 12 |
| 135 × 91 × 196 | 112 | 2 → 2 | 2 → 2 | 2 → 2 | 1 → 1 | 73 / 73 / 73 |
| 154 × 107 × 171 | 94 | 3 → 4 | 4 → 5 | 3 → 4 | 2 → 2 | 57 / 55 / 57 |
| 177 × 123 × 143 | 100 | 4 → 4 | 5 → 5 | 4 → 4 | 1 → 1 | 43 / 41 / 42 |
| 230 × 157 × 58 | 72 | 5 → 8 | 5 → 8 | 5 → 8 | 5 → 8 | 25 / 25 / 25 |
| 158 × 109 × 135 | 62 | 3 → 3 | 4 → 4 | 3 → 3 | 2 → 2 | 55 / 55 / 55 |

Gesamt: **81 → 109** direkte Grundflächentreffer. Verlorene bisherige direkte Oracle-Treffer: **0**. Gleiche Maximalbelegung ist kein Nachweis, dass alle Muster mit dieser Stückzahl erzeugt werden.

Passende Greifpartitionen steigen von 80 auf 103, gemeinsame OPS*-Treffer von 64 auf 77. Die neue Konstruktion beseitigt die Maximalbelegungslücken bei 147 × 104, 158 × 82 und 154 × 107 mm. Bei 177 × 123 mm steigt das Maximum von 41 auf 42; MultiPack erreicht weiterhin 43.

## Mengen und verbleibende Abweichungen

| Karton | Solver vorher → nachher | Fehlende direkte Oracle-Muster | Zusätzliche Solveridentitäten ohne direkte Oracle-Grundfläche | Gerichtete Winkel | Zyklen | Griffreihenfolge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 147 × 104 × 139 | 1882 → 2147 | 56 | 2138 | 9 | 9 | 2 |
| 158 × 82 × 165 | 1997 → 2497 | 63 | 2491 | 5 | 5 | 2 |
| 172 × 130 × 104 | 1472 → 1972 | 86 | 1970 | 2 | 2 | 1 |
| 148 × 148 × 122 | 1128 → 1610 | 0 | 941 | 1 | 1 | 1 |
| 250 × 165 × 164 | 1087 → 1249 | 59 | 1240 | 7 | 7 | 7 |
| 380 × 250 × 200 | 1440 → 1456 | 11 | 1450 | 6 | 6 | 6 |
| 245 × 98 × 174 | 971 → 1306 | 53 | 1292 | 12 | 12 | 12 |
| 157 × 110 × 175 | 1714 → 2078 | 38 | 2071 | 7 | 7 | 2 |
| 249 × 170 × 136 | 1284 → 1442 | 61 | 1433 | 7 | 7 | 7 |
| 157 × 106 × 150 | 1763 → 2135 | 94 | 2120 | 15 | 15 | 6 |
| 308 × 220 × 188 | 1787 → 1859 | 19 | 1842 | 17 | 17 | 17 |
| 135 × 91 × 196 | 2078 → 2475 | 110 | 2473 | 2 | 2 | 1 |
| 154 × 107 × 171 | 1794 → 2215 | 90 | 2211 | 4 | 4 | 2 |
| 177 × 123 × 143 | 1396 → 1687 | 96 | 1683 | 4 | 4 | 1 |
| 230 × 157 × 58 | 909 → 1106 | 64 | 1098 | 8 | 8 | 8 |
| 158 × 109 × 135 | 1745 → 2215 | 59 | 2210 | 3 | 3 | 2 |

Die neue Familie erhöht auch die Zahl zusätzlicher Solveridentitäten. Kandidatenreihenfolge, vollständige operative Parität und alle verschachtelten Geometrien sind weiterhin offen. Die Quellverteilungen bleiben die im vorherigen Bericht aufgeführten; alle nachher erzeugten Verteilungen und Trefferordnungen sind im externen Vergleich gespeichert.

Ein externer Folgeversuch mit vier unabhängig dimensionierten kompakten Eckrastern wurde nicht übernommen: 932 Varianten bei 147 × 104 trafen nur eine Oracle-Grundfläche, 896 Varianten bei 158 × 82 ebenfalls nur eine, und 720 Varianten bei 157 × 106 keine. Das erklärt die fehlenden verschachtelten Muster noch nicht hinreichend. Der nächste Ansatz ist die Zerlegung der verbleibenden Muster in rekursive Teilbereiche einschließlich ihrer jeweiligen Abstandsverteilung, statt allein weitere unabhängige Eckgrößen zu enumerieren.

## Frischer Nachbarfall und Referenzkontrolle

- 146 × 104 mm: 65 validierte Oracle-Kandidaten; direkte Grundflächen 3 → 8, Greifpartitionen 2 → 2, OPS* 1 → 1.
- 201 × 139 mm: 87 validierte Oracle-Kandidaten; direkte Grundflächen 8 → 8, Greifpartitionen 8 → 8, OPS* 3 → 3.
- 203 × 139 mm: 87 validierte Oracle-Kandidaten; direkte Grundflächen 8 → 8, Greifpartitionen 8 → 8, OPS* 3 → 3.
- 300 × 240 mm: 24 validierte Oracle-Kandidaten; direkte Grundflächen 9 → 12, Greifpartitionen 9 → 12, OPS* 9 → 12.

146 × 104 × 139 mm wurde nach der Anpassung in derselben isolierten Desktop-Kopie frisch eingegeben und mit allen 65 Kandidaten exportiert. Die Eingaben wurden per UI kontrolliert; Maße, Höhe, Palette und Einlaufrichtung wurden exportverifiziert. Nur die Länge unterscheidet sich vom Diagnosefall 147 × 104 × 139 mm. Für die Vorher-Messung deaktiviert ein externer Loader ausschließlich den Aufruf der neuen Familie, ohne Produktionsdateien zu ändern; dieser Kontrollaufbau reproduziert zusätzlich die alte 147-mm-Abdeckung. Abstand und Mehrfachgreifen bleiben UI-Evidenz. Keine weitere App-Instanz wurde gestartet.

## Prüfungen

- `npm run typecheck` und `npm run check` erfolgreich.
- Gesamtsuite `npx vitest run --maxWorkers=1`: **793 bestanden, zwei opt-in Tests übersprungen**, 110 Testdateien bestanden und eine übersprungen; kein unbehandelter Fehler.
- Ein vorheriger Lauf mit zwei Workern und parallelen Analysen meldete trotz bestandener Assertions einen Vitest-RPC-Timeout und wird nicht als erfolgreich gewertet.
- Drei neue Verhaltenstests prüfen 40 exakt konstruierte Paketpositionen einschließlich ungleicher Seitenbreiten und kompakter Aufnahmegruppen, positiven Mindestabstand und 38 Pakete bei Abstand 3 sowie Abbruch und Familienlimit. Bestehende Tests bestätigen Determinismus in beiden Äquivalenzmodi.
- Die bisherige Sieben-Kandidaten-Inventur bleibt exakt geprüft; 34 neue Kandidaten werden separat gezählt. Keine Fall-ID-Sonderbehandlung, keine gespeicherten Oracle-Ergebnislisten, keine Änderung der Corpus-Gates. Captures und Analyseprogramme bleiben außerhalb des Repositorys.
