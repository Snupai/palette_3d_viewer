# MultiPack-Liveparität – 07.09.2026

Alle folgenden Fremdergebnisse sind **Observed**, synthetisch und neu erfasst. Keine Kundenoriginale, ROB-Rohtexte oder absoluten Capturepfade sind Bestandteil dieses Berichts.

## Build und Bedienung

MULTIPACK für Roboter **2.1.315.25**, native x86-EXE. Quelle und neue beschreibbare Kopie wurden mit dem vorhandenen Setup geprüft. SHA-256: `629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff`. Bestehende Projekte, Datenbanken und Captures wurden nicht ersetzt.

Computer Use erkannte das sichtbare Fenster nicht. Die native Diagnose fand ein Delphi-Hilfsfenster `TApplication` und die tatsächliche Oberfläche `Tmain`; anschließend erfolgten Eingabe und Navigation über den nativen Windows-Zugriff und der vollständige Export über den vorhandenen Capture-Runner. Die Windows-Hauptfensterkennung allein reichte nicht. Die VCL-Zahlenfelder wurden per Tastatureingabe geändert und über `WM_GETTEXT` verifiziert; `GetWindowText` konnte noch alte Werte melden.

## Matrix und Evidenz

Gemeinsam: EURO-Palette 1200 × 800 mm, Höhe des Pakets 231 mm, Über-/Unterhang 0, Mehrfachgreifen aktiviert, Greifer `schmalzgripper (1)`, Palettierrichtung `x-,y+`. Alle Kandidaten wurden in Listenreihenfolge als einzelne ROB-Dateien exportiert. Paket-/Palettenmaße und Einlaufrichtung sind exportverifiziert; Abstand und weitere UI-Einstellungen sind UI-bestätigt.

Kein Sollstückzahlfeld war im tatsächlich bedienten Eingabedialog vorhanden. Die Manifeste führen daher `requestedPackagesPerLayer: null`. „31“ bezeichnet im erneuten Referenzlauf eine **Ergebniszahl**, keine nachgewiesene Eingabebeschränkung. Bei angefordertem 199 × 200 mm meldete die App ausdrücklich den Tausch von Länge und Breite; erfasst wurde anschließend 200 × 199 mm.

| Paket L × B / Abstand (mm) | Kandidaten | Verteilung Pakete je Lage: Kandidaten |
| --- | ---: | --- |
| 201 × 139 | 87 | 31: 7; 30: 25; 29: 15; 28: 15; 27: 11; 26: 8; 25: 4; 24: 2 |
| 300 × 200 | 44 | 16: 8; 15: 14; 14: 20; 12: 2 |
| 299 × 200 | 43 | 16: 7; 15: 14; 14: 20; 12: 2 |
| 301 × 200 | 31 | 14: 3; 13: 5; 12: 23 |
| 300 × 200 / Abstand 5 | 36 | 12: 11; 11: 18; 10: 6; 9: 1 |
| 200 × 200 | 1 | 24: 1 |
| 200 × 199 | 109 | 24: 109 |
| 400 × 100 | 52 | 24: 49; 22: 1; 20: 1; 18: 1 |
| 200 × 139 | 64 | 33: 8; 32: 28; 31: 22; 30: 3; 29: 1; 28: 2 |
| 202 × 139 | 87 | 31: 7; 30: 25; 29: 15; 28: 15; 27: 11; 26: 8; 25: 4; 24: 2 |

**554 Exporte** insgesamt, alle vollständig, parsergültig und manifest-hashgleich. Innerhalb jedes Falls sind alle Byte-Digests verschieden. Dies behauptet keine eindeutigen Geometrien.

Die Exporte enthalten jeweils zwei geometrisch identische Muster; die verglichene erste Lage repräsentiert damit die Grundfläche des jeweiligen Kandidaten. Es wurden keine unterschiedlichen zweiten Grundflächen übergangen.

Die beiden Einlaufrichtungen waren bei den geprüften Eingabedialogen für den ausgewählten Greifer deaktiviert, auch bei 400 × 100 mm; „Längs“ war ausgewählt. Alle Exporte enthalten Richtung 0. Im Greiferdialog wurden 450 mm Aufnahmelänge und die Freigaben 0°, 90°, 180°, 270° direkt bestätigt. Richtung 1 und eingeschränkte Rotationsfreigaben bleiben **nicht geprüft**: Beim Versuch eines elften Falls war Windows gesperrt; die Winkeländerung wurde nicht bestätigt und kein weiterer Capture angelegt. Der Solververgleich verwendet explizit alle vier orthogonalen Drehungen und höchstens zwei Pakete pro Griff, begrenzt durch die 450-mm-Aufnahmelänge des vorhandenen Greiferprofils. Damit ergeben sich bei 299–400 mm Einzelgriffe und bei 200–202 mm bis zu zwei Pakete pro Griff. Dies entspricht der bereits vorhandenen Begrenzung in den Website-SolverControls.

## Vergleichsmethode

Vorher: bestehender Standard `candidateEquivalence: "pallet-symmetry"`. Nachher: neuer expliziter Modus `candidateEquivalence: "identity"`, einschließlich Regionendrafts in der Symmetrieerzeugung. Der produktive Standard wurde nicht umgestellt. Beide verwenden `compact-centered`, gemischte Orientierungen, 500 Kandidaten je Generator und das Produktionsbudget mit 1.000.000 Arbeitseinheiten, 10.000 Frontier-Zuständen und 1.250 gespeicherten Regionendrafts. Die Nachher-Werte sind kein behaupteter MultiPack-Kompatibilitätsmodus.

„Direkt“ meint gleiche Paketmittelpunkte und gedrehte Rechteckgrundflächen **ohne** Spiegelung/Drehung des Gesamtmusters, innerhalb 0,500001 mm ROB-Koordinatentoleranz. „Winkel“ verlangt zusätzlich gleichen gerichteten Paketwinkel, auch beim Quadrat. „Symmetrie“ erlaubt die explizit geprüften rahmenerhaltenden Transformationen und wird separat gezählt. Mehrere Oracle-Kandidaten dürfen dieselbe Grundfläche besitzen; deshalb werden Treffermengen nach Oracle-Ordinalen gezählt.

„OPS*“ verlangt beim selben direkten Treffer gemeinsam Winkel, Greifpartition, Zykluszahl und Griffreihenfolge. Pick-/Place-TCP-Werte, alle dx/dy-Felder, Etiketten und Kollisionsfreiheit sind nicht Bestandteil dieses Checks: **OPS* ist keine vollständige operative Parität.** „Blöcke“ bleibt unverified.

## Gleiche Maße ohne Stückzahlvorgabe

Diese Läufe geben auch dem Solver keine Sollstückzahl vor. Alle Paarwerte bedeuten Vorher → Nachher.

| Fall | Solver-Kandidaten | Direkt / Oracle | Winkel / Oracle | Symmetrie / Oracle | OPS* / Oracle |
| --- | ---: | ---: | ---: | ---: | ---: |
| 201 × 139 | 339 → 1029 | 4 → 4 / 87 | 4 → 4 / 87 | 4 → 4 / 87 | 1 → 1 / 87 |
| 300 × 200 | 640 → 1226 | 11 → 14 / 44 | 11 → 14 / 44 | 20 → 20 / 44 | 11 → 14 / 44 |
| 299 × 200 | 1267 → 1910 | 8 → 8 / 43 | 8 → 8 / 43 | 11 → 11 / 43 | 8 → 8 / 43 |
| 301 × 200 | 1233 → 1893 | 12 → 13 / 31 | 12 → 13 / 31 | 14 → 14 / 31 | 12 → 13 / 31 |
| 300 × 200 / Abstand 5 | 1094 → 1936 | 13 → 15 / 36 | 13 → 15 / 36 | 17 → 17 / 36 | 13 → 15 / 36 |
| 200 × 200 | 194 → 721 | 1 → 1 / 1 | 1 → 1 / 1 | 1 → 1 / 1 | 1 → 1 / 1 |
| 200 × 199 | 1481 → 2068 | 8 → 9 / 109 | 8 → 9 / 109 | 15 → 15 / 109 | 2 → 2 / 109 |
| 400 × 100 | 239 → 746 | 15 → 20 / 52 | 15 → 16 / 52 | 20 → 20 / 52 | 15 → 16 / 52 |
| 200 × 139 | 315 → 838 | 2 → 2 / 64 | 2 → 2 / 64 | 2 → 2 / 64 | 1 → 1 / 64 |
| 202 × 139 | 366 → 1055 | 4 → 5 / 87 | 4 → 4 / 87 | 5 → 5 / 87 | 1 → 1 / 87 |

| Fall | Max. Paketanzahl Oracle / Vorher / Nachher | Fehlende direkte Grundflächenkandidaten | Zusätzliche Solverkandidaten ohne direkten Grundflächentreffer | Direkte Treffer mit exakt 0 mm Abweichung |
| --- | ---: | ---: | ---: | ---: |
| 201 × 139 | 31 / 30 / 30 | 83 → 83 | 335 → 1020 | 0 → 0 |
| 300 × 200 | 16 / 16 / 16 | 33 → 30 | 629 → 1196 | 11 → 14 |
| 299 × 200 | 16 / 16 / 16 | 35 → 35 | 1247 → 1887 | 1 → 1 |
| 301 × 200 | 14 / 14 / 14 | 19 → 18 | 1213 → 1860 | 2 → 2 |
| 300 × 200 / Abstand 5 | 12 / 12 / 12 | 23 → 21 | 1075 → 1910 | 12 → 14 |
| 200 × 200 | 24 / 24 / 24 | 0 → 0 | 138 → 401 | 1 → 1 |
| 200 × 199 | 24 / 24 / 24 | 101 → 100 | 1467 → 2048 | 2 → 2 |
| 400 × 100 | 24 / 24 / 24 | 37 → 32 | 224 → 698 | 15 → 20 |
| 200 × 139 | 33 / 33 / 33 | 62 → 62 | 313 → 834 | 1 → 1 |
| 202 × 139 | 31 / 30 / 30 | 83 → 82 | 362 → 1043 | 1 → 1 |

Keine der Kandidatenmengen ist identisch. Die Kandidatenreihenfolge ist damit ebenfalls nicht identisch. Grundflächentreffer werden nicht als Rankingtreffer ausgegeben. Alle hier als unvollständig gemeldeten Budgetabbrüche bleiben Teil der Aussagegrenze.

## Diagnose mit exakten beobachteten Stückzahlen

Hier wird jede in MultiPack beobachtete Stückzahl einzeln angefragt. Die zusammengefassten Solverkandidaten sind eine **Vereinigung separater Abfragen**, kein einzelner MultiPack-äquivalenter Lauf. Diese Diagnose trennt fehlendes Generatorvokabular von Problemen der Suche über mehrere Stückzahlen.

| Fall | Solver-Kandidaten (Vereinigung) | Direkt | Winkel | Symmetrie | Greifpartition | OPS* |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 201 × 139 | 8814 → 13217 | 10 → 15 | 10 → 10 | 21 → 21 | 6 → 8 | 6 → 6 |
| 300 × 200 | 2169 → 4124 | 15 → 18 | 15 → 18 | 24 → 24 | 15 → 18 | 15 → 18 |
| 299 × 200 | 2912 → 4845 | 12 → 13 | 12 → 12 | 15 → 16 | 12 → 13 | 12 → 12 |
| 301 × 200 | 1188 → 2253 | 12 → 14 | 12 → 13 | 14 → 14 | 12 → 14 | 12 → 13 |
| 300 × 200 / Abstand 5 | 4261 → 7059 | 14 → 16 | 14 → 16 | 20 → 20 | 14 → 16 | 14 → 16 |
| 200 × 200 | 75 → 512 | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| 200 × 199 | 1317 → 1763 | 8 → 12 | 8 → 10 | 18 → 18 | 5 → 8 | 2 → 2 |
| 400 × 100 | 3028 → 4788 | 16 → 22 | 16 → 17 | 22 → 22 | 16 → 22 | 16 → 17 |
| 200 × 139 | 5261 → 8026 | 3 → 4 | 3 → 3 | 8 → 8 | 3 → 4 | 2 → 2 |
| 202 × 139 | 8616 → 13011 | 9 → 17 | 9 → 10 | 21 → 21 | 5 → 9 | 5 → 6 |

## Implementierte Änderungen

- `SolverOptions.candidateEquivalence` und Kandidatenfinalisierung: optional vollständige erzeugte Kandidatenidentität statt automatischer Palettensymmetrie-Zusammenführung. Exakte Duplikate werden weiterhin deterministisch zusammengeführt.
- Im Identitätsmodus gehen auch Regionendrafts in die vorhandene Symmetrieerzeugung ein. Rotationsfreigaben, Validierung, Abbruchverhalten und Generatorlimits gelten weiterhin. Keine Fall-IDs oder gespeicherten Oracle-Ergebnislisten im Solver.
- Der Paritätsreport erkennt jetzt auch erschöpfte Region-Arbeits- und Frontier-Budgets. Zuvor konnte er trotz entsprechender Solverdiagnose vollständige Generierung melden.
- Tests prüfen sechs getrennte gerichtete Varianten statt zwei Symmetrieklassen, die Zusammenführung eines echten Duplikats, Regionensymmetrien bei eingeschränkten Rotationen und Limits sowie Unabhängigkeit von Generatorreihenfolge und Progress-Batching in beiden Modi.

## Beobachtungen, Grenzen und nächster Ansatz

Bestätigt für diese Fälle: Die Stückzahlverteilung ist nicht einfach ein lückenloses Intervall; 300 × 200 mm erzeugt beispielsweise 12er-, 14er-, 15er- und 16er-Muster, aber keine 13er. Quadratische und fast quadratische Pakete zeigen stark unterschiedliche Inventare. Die angezeigte Zykluszahl allein erklärt die Rangfolge nicht; schon die ersten Referenzlösungen haben die Folge 22, 27, 26, 31, 24, 23, 23. Daraus folgt kein interner MultiPack-Algorithmus.

Die Verteilung innerer Abstände, vollständige Auswahl schwächer belegter Muster, exakte Greiferparameter und Rankingregeln bleiben offen. Reine Symmetrieerweiterung erhöht auch die Zahl zusätzlicher Kandidaten und löst diese Fragen nicht.

Der wichtigste nächste Ansatz ist die deterministische Budgetverteilung über Zielstückzahlen: Der freie Referenzlauf erreicht nur 30 Pakete, während exakte 31er-Abfragen bereits alle sieben 31er-Oracle-Muster als Grundflächensymmetrieklasse repräsentieren. Die Suche plant Zielzahlen absteigend; zu untersuchen ist, wie viel Budget unerreichbare hohe Ziele verbrauchen und wie erreichbare dichte Ziele früh genug bedient werden können. Eine faire Verteilung muss anschließend gegen diese Matrix und weitere nicht zur Anpassung verwendete Maße geprüft werden. Keine willkürliche Belegungsuntergrenze aus diesem Einzelbefund ableiten.

## Prüfungen

- `npm run typecheck` nach jeder Repository-Änderung; abschließend erfolgreich.
- `npm run check`: erfolgreich.
- Solver, Kandidaten, generierter Vergleich und Corpus-Integration: 67 Tests erfolgreich.
- Paritäts-/Corpus-Suite: 59 Tests erfolgreich, zwei externe opt-in Tests ohne Corpus-Konfiguration übersprungen.
- Corpus-Gates unverändert; neue Tests verwenden ausschließlich konstruierte synthetische Modelle.

## Verteilungen und operative Teilprüfungen im freien Lauf

| Fall | Solver vorher: Pakete je Lage → Kandidaten | Solver nachher: Pakete je Lage → Kandidaten |
| --- | --- | --- |
| 201 × 139 | 30: 1; 29: 10; 28: 21; 27: 24; 26: 64; 25: 31; 24: 18; 23: 23; 22: 16; 21: 13; 20: 13; 19: 10; 18: 11; 17: 8; 16: 15; 15: 5; 14: 8; 13: 8; 12: 8; 11: 8; 10: 7; 9: 4; 8: 3; 7: 5; 6: 3; 5: 1; 4: 1 | 30: 5; 29: 49; 28: 116; 27: 91; 26: 275; 25: 100; 24: 46; 23: 47; 22: 53; 21: 23; 20: 39; 19: 17; 18: 26; 17: 12; 16: 27; 15: 5; 14: 23; 13: 14; 12: 14; 11: 14; 10: 13; 9: 7; 8: 3; 7: 5; 6: 3; 5: 1; 4: 1 |
| 300 × 200 | 16: 6; 15: 179; 14: 396; 13: 3; 12: 20; 11: 2; 10: 10; 9: 6; 8: 5; 7: 4; 6: 3; 5: 4; 4: 1; 3: 1 | 16: 31; 15: 352; 14: 698; 13: 6; 12: 65; 11: 5; 10: 36; 9: 9; 8: 8; 7: 7; 6: 3; 5: 4; 4: 1; 3: 1 |
| 299 × 200 | 16: 84; 15: 461; 14: 666; 13: 3; 12: 20; 11: 1; 10: 12; 9: 5; 8: 4; 7: 3; 6: 3; 5: 3; 4: 1; 3: 1 | 16: 170; 15: 586; 14: 1011; 13: 6; 12: 66; 11: 1; 10: 41; 9: 8; 8: 7; 7: 6; 6: 3; 5: 3; 4: 1; 3: 1 |
| 301 × 200 | 14: 21; 13: 100; 12: 569; 11: 489; 10: 18; 9: 9; 8: 9; 7: 6; 6: 4; 5: 5; 4: 2; 3: 1 | 14: 28; 13: 105; 12: 938; 11: 719; 10: 38; 9: 18; 8: 26; 7: 9; 6: 4; 5: 5; 4: 2; 3: 1 |
| 300 × 200 / Abstand 5 | 12: 51; 11: 246; 10: 728; 9: 28; 8: 18; 7: 11; 6: 4; 5: 3; 4: 4; 3: 1 | 12: 137; 11: 487; 10: 1211; 9: 47; 8: 29; 7: 13; 6: 4; 5: 3; 4: 4; 3: 1 |
| 200 × 200 | 24: 56; 23: 4; 22: 14; 21: 6; 20: 22; 19: 4; 18: 8; 17: 4; 16: 22; 15: 8; 14: 4; 13: 4; 12: 11; 11: 4; 10: 6; 9: 6; 8: 3; 7: 4; 6: 2; 5: 2 | 24: 320; 23: 16; 22: 52; 21: 24; 20: 74; 19: 13; 18: 29; 17: 13; 16: 64; 15: 14; 14: 10; 13: 10; 12: 18; 11: 10; 10: 18; 9: 12; 8: 10; 7: 10; 6: 2; 5: 2 |
| 200 × 199 | 24: 1344; 23: 6; 22: 20; 21: 7; 20: 18; 19: 5; 18: 5; 17: 5; 16: 24; 15: 6; 14: 4; 13: 4; 12: 7; 11: 5; 10: 5; 9: 5; 8: 3; 7: 4; 6: 2; 5: 2 | 24: 1805; 23: 15; 22: 47; 21: 16; 20: 30; 19: 11; 18: 8; 17: 8; 16: 54; 15: 9; 14: 7; 13: 7; 12: 10; 11: 8; 10: 8; 9: 8; 8: 6; 7: 7; 6: 2; 5: 2 |
| 400 × 100 | 24: 22; 23: 3; 22: 36; 21: 8; 20: 19; 19: 8; 18: 22; 17: 10; 16: 13; 15: 12; 14: 12; 13: 13; 12: 10; 11: 9; 10: 10; 9: 8; 8: 8; 7: 6; 6: 4; 5: 3; 4: 2; 3: 1 | 24: 112; 23: 12; 22: 125; 21: 26; 20: 58; 19: 23; 18: 72; 17: 28; 16: 32; 15: 37; 14: 28; 13: 37; 12: 22; 11: 24; 10: 26; 9: 17; 8: 24; 7: 18; 6: 7; 5: 9; 4: 5; 3: 4 |
| 200 × 139 | 33: 12; 32: 12; 31: 17; 30: 39; 29: 23; 28: 53; 27: 13; 26: 13; 25: 7; 24: 7; 23: 9; 22: 9; 21: 12; 20: 12; 19: 7; 18: 10; 17: 8; 16: 7; 15: 5; 14: 4; 13: 8; 12: 6; 11: 4; 10: 3; 9: 4; 8: 4; 7: 4; 6: 2; 5: 1 | 33: 31; 32: 54; 31: 37; 30: 141; 29: 74; 28: 197; 27: 21; 26: 33; 25: 15; 24: 13; 23: 13; 22: 17; 21: 16; 20: 34; 19: 14; 18: 17; 17: 12; 16: 21; 15: 8; 14: 10; 13: 14; 12: 9; 11: 7; 10: 6; 9: 7; 8: 7; 7: 7; 6: 2; 5: 1 |
| 202 × 139 | 30: 1; 29: 10; 28: 22; 27: 24; 26: 64; 25: 31; 24: 19; 23: 26; 22: 18; 21: 14; 20: 14; 19: 9; 18: 13; 17: 11; 16: 15; 15: 6; 14: 9; 13: 10; 12: 11; 11: 8; 10: 6; 9: 5; 8: 6; 7: 7; 6: 4; 5: 2; 4: 1 | 30: 5; 29: 49; 28: 120; 27: 91; 26: 271; 25: 100; 24: 50; 23: 53; 22: 55; 21: 27; 20: 43; 19: 13; 18: 25; 17: 15; 16: 27; 15: 6; 14: 24; 13: 16; 12: 17; 11: 11; 10: 9; 9: 8; 8: 6; 7: 7; 6: 4; 5: 2; 4: 1 |

| Fall | Greifpartition | Zykluszahl | Griffreihenfolge |
| --- | ---: | ---: | ---: |
| 201 × 139 | 1 → 1 | 4 → 4 | 1 → 1 |
| 300 × 200 | 11 → 14 | 11 → 14 | 11 → 14 |
| 299 × 200 | 8 → 8 | 8 → 8 | 8 → 8 |
| 301 × 200 | 12 → 13 | 12 → 13 | 12 → 13 |
| 300 × 200 / Abstand 5 | 13 → 15 | 13 → 15 | 13 → 15 |
| 200 × 200 | 1 → 1 | 1 → 1 | 1 → 1 |
| 200 × 199 | 5 → 6 | 8 → 9 | 2 → 2 |
| 400 × 100 | 15 → 20 | 15 → 20 | 15 → 20 |
| 200 × 139 | 2 → 2 | 2 → 2 | 1 → 1 |
| 202 × 139 | 1 → 2 | 4 → 5 | 1 → 2 |

Die einzelnen Teilprüfungen dürfen unterschiedliche direkte Treffer verwenden; nur OPS* verlangt einen gemeinsamen Treffer. Benachbarte Maße 200 × 139 und 202 × 139 wurden nach der allgemeinen Änderung als zusätzliche Kontrolle erfasst; keine daraus abgeleitete Fallsonderbehandlung. Alle Suchläufe bleiben budgetbegrenzt.

## Kandidatenrang und Außenmaße

| Fall | Direkter Grundflächentreffer am selben Listenrang, vorher → nachher |
| --- | ---: |
| 201 × 139 | 0 → 0 |
| 300 × 200 | 0 → 0 |
| 299 × 200 | 1 → 1 |
| 301 × 200 | 0 → 1 |
| 300 × 200 / Abstand 5 | 0 → 0 |
| 200 × 200 | 1 → 1 |
| 200 × 199 | 1 → 1 |
| 400 × 100 | 3 → 0 |
| 200 × 139 | 0 → 0 |
| 202 × 139 | 0 → 0 |

Gleicher Listenrang wird hier nur für einen direkten Grundflächentreffer gezählt; er ist kein Nachweis einer gleichen Gesamtfolge oder operativen Identität. Außenmaße der Oracle-Muster sind in den externen Vergleichszeilen erfasst. Der Positions-/Grundflächenvergleich prüft sie mittelbar mit; eine gesonderte Regelanalyse von Rand- und Innenabständen ist noch offen.

## Hash-only Capture-Nachweise

Externe Dateien bleiben außerhalb des Repositorys. Maßgeblich sind je Fall `oracle-manifest.json`, die synthetischen Einzel-ROB-Exporte sowie `comparison-free-count.json` und `comparison-multipick.json`; für die größeren Pakete sind ausschließlich die korrigierten `comparison-profile-free-count.json` und `comparison-profile-multipick.json` maßgeblich. Die Hashes beziehen sich auf die vollständigen Manifestdateien.

| Synthetische Case-ID | Manifest SHA-256 |
| --- | --- |
| reference-201x139 | `cfba0af89d1bcf95d0d2739134833189df5aa3187a73ee1820a2d46356013b4f` |
| grid-300x200 | `4662b1357683c1692005809843985e7a99802515b438aa7b62037a70d0bda09f` |
| grid-299x200 | `c8cc0c08c23cba1187cfe48c633eb72f50456a26daad810cc96838a841904017` |
| grid-301x200 | `229bd52ab4621a9c895f9986adf95b897a0778810628c2cc1cca9b0b5b8098c6` |
| grid-300x200-gap5 | `f76f0183e60b22d18834dde93c0ffc24a1429ec3c4e1ba6c49bcec2fb7d53af8` |
| square-200x200 | `c659bfeea6b61d6729da4984af231f00d445aa76da2bcd4b77f49161764fb144` |
| near-square-199x200 | `a6742a6f6c5fcc14786858b1bfddb8bdcfb31267d01ebd92d32fc5739ad2fca5` |
| long-400x100 | `bcd28bf6f574decb0e870c4c84ccc6e3a05debd0b10f2518e00de51666c7bcf8` |
| neighbor-200x139 | `c7dfda8e34501e28c43cc273bd376fce4f4305db305ea8e375064bece6e29d61` |
| neighbor-202x139 | `b3ef463854fa513c8d94b1a2b88531c0485c8fbfd6f4b0089fae14515406b3ad` |
