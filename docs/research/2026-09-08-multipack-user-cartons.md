# MultiPack: 16 zusätzliche Kartonmaße – 08.09.2026

Alle 16 vom Nutzer angegebenen Maße wurden tatsächlich in der isolierten, beschreibbaren Desktop-Kopie eingegeben. Insgesamt **1068 Kandidaten** wurden vollständig exportiert und mit dem vorhandenen Validator geprüft. Bestehende Projekte, Datenbanken und Captures wurden nicht überschrieben.

Build **2.1.315.25**, SHA-256 `629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff`. Der Prozess wurde wiederverwendet; keine weitere MultiPack-Instanz gestartet. Der Computer-Use-Dienst lieferte keine MultiPack-Fenster, deshalb kam der zuvor vom Nutzer autorisierte native Capture-Workflow zum Einsatz.

## Eingaben und Vergleichsbedingungen

- EURO-Palette 1200 × 800 mm, Abstand 0, Einlauf längs, Mehrfachgreifen aktiv. Die individuelle Höhe wurde für jeden Karton eingegeben und in jedem Export geprüft.
- Paket- und Palettenmaße sowie Einlaufrichtung sind exportverifiziert. Abstand und Mehrfachgreifen sind UI-geprüft und nicht aus ROB-Dateien ableitbar. Für diese Matrix wurden weder Quer-Einlauf noch eingeschränkte Rotationen behauptet.
- Keine exakte Stückzahlbedingung im Solver. 500 Kandidaten je Generator, unverändertes produktives Regionsbudget. Alle Vergleiche bleiben suchbudgetbegrenzt.
- Vergleichsprofil mit Etikettenmodell „bottom“ und erlaubten Winkeln 0/90/180/270. Die Greifkapazität folgt dem beobachteten 450-mm-Profil: drei bei 147, 148 und 135 mm Länge, zwei bei den übrigen Längen unter 225 mm, sonst eins. Die tatsächlichen Exporte bestätigen Dreiergriffe; die frühere Vergleichsbegrenzung auf zwei ist für diese kurzen Kartons ungeeignet.
- Die Tabellen verwenden `candidateEquivalence: identity`. Palettensymmetrien bleiben getrennt, gerichtete Winkel werden zusätzlich geprüft. Grundflächentoleranz: 0,500001 mm.
- Beim quadratischen Fall wurde die einzelne Tabellenzeile samt belegtem Raster visuell bestätigt, bevor der Runner mit expliziter Erwartung 1 fortgesetzt wurde.
- Der letzte Capture wurde nach einem Export-Timeout bei 59/62 Dateien mit dem unveränderten Resume-Verfahren abgeschlossen. Alle 59 bestehenden Dateien wurden erneut exportiert und auf identische Bytes geprüft, bevor die letzten drei ergänzt wurden. Die Eingaben wurden anschließend nochmals im Dialog kontrolliert, ohne neu zu berechnen.
- Alle 1068 Exporte enthalten zwei geometrisch identische Lagenmuster; dies wurde für jedes Muster separat geprüft. Die operativen Vergleichszahlen beziehen sich auf das erste Quellmuster. Geometrische Duplikate belegen keine identischen Griffdaten oder vollständige Stapel-/TCP-Parität.
- Im Eingabedialog war Einlauf längs ausgewählt; die Umschaltung auf quer war beim aktiven Profil deaktiviert. Die Palettierrichtung war `x-,y+`. Das Etikettenmodell ist eine beobachtungsbasierte Vergleichseinstellung, keine aus den ROB-Dateien verifizierte Eingabe.

## Vollständige Matrix und Vorher/Nachher

Vorher und nachher unterscheiden sich hier ausschließlich durch die neue Gruppierungsregel; die Kapazitätskorrektur ist für die drei kurzen Kartons bereits in beiden Werten enthalten. „Direkt“ zählt vollständige Oracle-Grundflächen ohne Palettentransformation. „Sym.“ umfasst zusätzlich transformierte Treffer. OPS* verlangt gemeinsam Grundfläche, gerichtete Winkel, Greifpartition, Zykluszahl und Greifreihenfolge; vollständige TCP-Posen sind nicht eingeschlossen.

| Karton L × B × H | Oracle | Max. Kartons Oracle / Solver | Direkt vorher → nachher | Sym. nachher | Greifpartition vorher → nachher | OPS* vorher → nachher |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 147 × 104 × 139 | 65 | 61 / 60 | 4 → 4 | 4 | 2 → 3 | 2 → 2 |
| 158 × 82 × 165 | 68 | 71 / 70 | 4 → 4 | 4 | 0 → 4 | 0 → 2 |
| 172 × 130 × 104 | 88 | 40 / 40 | 2 → 2 | 2 | 2 → 2 | 1 → 1 |
| 148 × 148 × 122 | 1 | 40 / 40 | 1 → 1 | 1 | 1 → 1 | 1 → 1 |
| 250 × 165 × 164 | 66 | 21 / 21 | 7 → 7 | 7 | 7 → 7 | 7 → 7 |
| 380 × 250 × 200 | 17 | 9 / 9 | 6 → 6 | 9 | 6 → 6 | 6 → 6 |
| 245 × 98 × 174 | 65 | 38 / 38 | 8 → 8 | 8 | 8 → 8 | 8 → 8 |
| 157 × 110 × 175 | 45 | 54 / 54 | 7 → 7 | 7 | 0 → 7 | 0 → 2 |
| 249 × 170 × 136 | 68 | 21 / 21 | 7 → 7 | 10 | 7 → 7 | 7 → 7 |
| 157 × 106 × 150 | 109 | 55 / 55 | 3 → 3 | 3 | 0 → 3 | 0 → 2 |
| 308 × 220 × 188 | 36 | 12 / 12 | 15 → 15 | 18 | 15 → 15 | 15 → 15 |
| 135 × 91 × 196 | 112 | 73 / 73 | 2 → 2 | 2 | 1 → 2 | 1 → 1 |
| 154 × 107 × 171 | 94 | 57 / 55 | 3 → 3 | 4 | 0 → 3 | 0 → 2 |
| 177 × 123 × 143 | 100 | 43 / 41 | 4 → 4 | 5 | 3 → 4 | 1 → 1 |
| 230 × 157 × 58 | 72 | 25 / 25 | 5 → 5 | 5 | 5 → 5 | 5 → 5 |
| 158 × 109 × 135 | 62 | 55 / 55 | 3 → 3 | 4 | 0 → 3 | 0 → 2 |

## Weitere Paritätsdimensionen

| Karton | Solveridentitäten | Fehlende Oracle-Grundflächen | Zusätzliche Solveridentitäten ohne direkten Treffer | Direkt exakt 0 mm | Winkel | Zyklen | Griffreihenfolge | Treffende Oracle-Ordinalpositionen |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 147 × 104 × 139 | 1882 | 61 | 1878 | 0 | 4 | 4 | 2 | 0 |
| 158 × 82 × 165 | 1997 | 64 | 1992 | 4 | 4 | 4 | 2 | 0 |
| 172 × 130 × 104 | 1472 | 86 | 1470 | 2 | 2 | 2 | 1 | 0 |
| 148 × 148 × 122 | 1128 | 0 | 941 | 1 | 1 | 1 | 1 | 1 |
| 250 × 165 × 164 | 1087 | 59 | 1078 | 1 | 7 | 7 | 7 | 1 |
| 380 × 250 × 200 | 1440 | 11 | 1434 | 6 | 6 | 6 | 6 | 1 |
| 245 × 98 × 174 | 971 | 57 | 963 | 1 | 8 | 8 | 8 | 0 |
| 157 × 110 × 175 | 1714 | 38 | 1707 | 0 | 7 | 7 | 2 | 0 |
| 249 × 170 × 136 | 1284 | 61 | 1275 | 1 | 7 | 7 | 7 | 1 |
| 157 × 106 × 150 | 1763 | 106 | 1760 | 0 | 3 | 3 | 2 | 1 |
| 308 × 220 × 188 | 1787 | 21 | 1772 | 15 | 15 | 15 | 15 | 0 |
| 135 × 91 × 196 | 2078 | 110 | 2076 | 0 | 2 | 2 | 1 | 0 |
| 154 × 107 × 171 | 1794 | 91 | 1791 | 2 | 3 | 3 | 2 | 0 |
| 177 × 123 × 143 | 1396 | 96 | 1392 | 1 | 4 | 4 | 1 | 0 |
| 230 × 157 × 58 | 909 | 67 | 904 | 2 | 5 | 5 | 5 | 1 |
| 158 × 109 × 135 | 1745 | 59 | 1740 | 2 | 3 | 3 | 2 | 1 |

Die stark unterschiedlichen Kandidatenmengen verhindern vollständige Reihenfolgeparität. Die letzte Spalte ist nur eine Teilprüfung gleicher Rangpositionen, kein Ranking-Paritätsnachweis. Außenmaße und innere Abstände sind über den vollständigen Positionsvergleich erfasst; eine separate Abstandssemantik des unbekannten MultiPack-Algorithmus wird daraus nicht behauptet.

## Oracle-Verteilung nach Paketanzahl

| Karton | Paketanzahl: Zahl der Kandidaten |
| --- | --- |
| 147 × 104 × 139 | 61: 14, 60: 20, 59: 17, 58: 3, 57: 3, 56: 2, 55: 2, 54: 3, 53: 1 |
| 158 × 82 × 165 | 71: 15, 70: 39, 69: 6, 68: 2, 67: 1, 66: 1, 63: 4 |
| 172 × 130 × 104 | 40: 20, 39: 29, 38: 15, 37: 1, 36: 13, 34: 9, 33: 1 |
| 148 × 148 × 122 | 40: 1 |
| 250 × 165 × 164 | 21: 11, 20: 20, 19: 22, 18: 11, 17: 1, 16: 1 |
| 380 × 250 × 200 | 9: 3, 8: 9, 7: 5 |
| 245 × 98 × 174 | 38: 17, 37: 21, 36: 24, 35: 1, 32: 2 |
| 157 × 110 × 175 | 54: 6, 53: 7, 52: 24, 51: 1, 50: 2, 49: 1, 48: 1, 47: 1, 45: 1, 44: 1 |
| 249 × 170 × 136 | 21: 12, 20: 20, 19: 21, 18: 12, 17: 1, 16: 2 |
| 157 × 106 × 150 | 55: 64, 54: 14, 53: 7, 52: 7, 51: 10, 50: 5, 49: 2 |
| 308 × 220 × 188 | 12: 11, 11: 18, 10: 6, 9: 1 |
| 135 × 91 × 196 | 73: 67, 72: 7, 71: 10, 70: 10, 69: 7, 68: 2, 67: 1, 66: 3, 65: 2, 64: 2, 63: 1 |
| 154 × 107 × 171 | 57: 24, 56: 22, 55: 14, 54: 6, 53: 9, 52: 10, 51: 7, 50: 1, 49: 1 |
| 177 × 123 × 143 | 43: 2, 42: 27, 41: 24, 40: 22, 39: 4, 38: 17, 36: 4 |
| 230 × 157 × 58 | 25: 12, 24: 23, 23: 26, 22: 5, 21: 5, 19: 1 |
| 158 × 109 × 135 | 55: 1, 54: 13, 53: 24, 52: 17, 51: 2, 50: 2, 49: 1, 47: 1, 46: 1 |

## Implementierte Regel und Grenzen

Die neue `axis-ends`-Regel teilt zusammenhängende Greifreihen in volle Gruppen plus Rest. In horizontalen Reihen liegt der Rest am negativen X-Ende, in vertikalen am positiven Y-Ende, unabhängig vom jeweiligen Gegenwinkel 0/180 beziehungsweise 90/270. Sie wird nur für das unveränderte beobachtete MultiPack-Greiferprofil und Einlauf längs automatisch gewählt. Andere oder bearbeitete Greiferprofile und der nicht bestätigte Quer-Einlauf behalten `centered-singleton`. Der Solver validiert die Regel als explizite Eingabebedingung. Generierte Griffpartitionen und automatische Robotics-Gruppierung teilen dieselbe Implementierung. Explizite importierte Zyklen und gespeicherte Mustergriffe werden weiterhin verwendet.

Die Regel wurde zuerst an 158 × 82 und 157 × 110 mm beobachtet und anschließend an weiteren Maßen geprüft, insbesondere 157 × 106 und 135 × 91 mm. Zusätzlich wurden die vorhandenen Neustart-Captures für 201 × 139 und 203 × 139 nachverglichen: jeweils acht direkte Geometrien unverändert, acht statt drei passende Greifpartitionen, weiterhin nur drei passende Griffreihenfolgen.

Über die 16 Fälle bleiben 81 direkte Grundflächentreffer unverändert. Passende Greifpartitionen steigen von 57 auf 80, gemeinsame OPS*-Treffer von 54 auf 64. Das ist ein operativer Teilgewinn und keine Erweiterung der geometrischen Abdeckung durch diese Gruppierungsänderung.

Die automatische Greifkapazität in Solver-Bedienung und Robotics folgt beim unveränderten MultiPack-Profil und Einlauf längs jetzt `floor(450 / Paketlänge)`, mindestens eins. Damit werden beispielsweise drei 147-mm-Kartons zugelassen. Maßänderungen aktualisieren das automatische Limit; ein ausdrücklich eingegebenes Limit bleibt erhalten. Deaktiviertes Mehrfachgreifen begrenzt auf eins. Geänderte und andere Profile behalten den bisherigen Standard. Die endgültige Gruppierung berücksichtigt weiterhin die reale maximale Aufnahmelänge.

Ein zusätzlicher Versuch, Pinwheel-Innenräume auch ohne exakte Stückzahlvorgabe maximal zu füllen, brachte an 147 × 104, 158 × 82 und 172 × 130 keine zusätzlichen direkten Treffer oder höhere Maximalbelegung. Er wurde zurückgenommen. Keine Fall-ID-Sonderbehandlung und keine übernommenen Ergebnislisten.

Vollständige MultiPack-Parität ist nicht erreicht. Besonders die Dichtelücken bei 147 × 104 (61/60), 158 × 82 (71/70), 154 × 107 (57/55) und 177 × 123 (43/41), verschachtelte Geometrien, viele Zusatzkandidaten und die Reihenfolge bleiben offen. Der nächste Ansatz ist die gezielte Suche nach den fehlenden 61er- und 71er-Geometrien einschließlich ihrer Restregionen und Prüfung der daraus abgeleiteten Zerlegung an benachbarten Maßen. Bloßes Erhöhen der Kandidatenzahl genügt nicht. „Blöcke“ bleibt unbekannt.

## Prüfungen

Die abschließenden Prüfungen sind erfolgreich: `npm run typecheck`, `npm run check` und `npx vitest run --maxWorkers=2` mit **790 bestandenen und zwei übersprungenen Tests** in 109 bestandenen und einer übersprungenen Testdatei. Nach der abschließenden Korrektur der Client-Direktive wurden Typecheck, Lint und die 15 SolverControls-Tests nochmals erfolgreich ausgeführt. Neue Domain-Tests prüfen exakte Gruppenmitglieder für alle vier Winkel, einen Rest von zwei Kartons bei Dreiergriffen, Unabhängigkeit von Eingabereihenfolge, Profil-/Einlaufgrenzen sowie Solver-Determinismus bei Generatorreihenfolge und Progress-Batching. Kapazitätstests decken die 150/151-mm-Grenze ab; der Bedienungstest prüft automatische Anpassung und Erhalt einer manuellen Begrenzung. Rohcapturen und Analyseprogramme bleiben außerhalb des Repositorys; Corpus-Gates unverändert.
