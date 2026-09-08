# Eigenständige verschachtelte Raster – 08.09.2026

**Teilfortschritt, keine vollständige MultiPack-Parität.** Die neue Familie
`stepped-block` erzeugt gefüllte Fünf-Raster-Ringe, Sechs- und Sieben-Raster-Ringe
sowie Neun-Raster-Treppen mit seitlichen Korridoren. Rasterzahlen werden aus
Paketmaßen, Mindestabstand und verfügbarem Platz berechnet. Es gibt weder eine
Laufzeitabhängigkeit von MultiPack noch hinterlegte Desktop-Ergebnislisten oder
Sonderfälle für bestimmte Paketmaße.

## Frische Desktop-Evidenz

In einer isolierten, beschreibbaren Kopie von **MULTIPACK für Roboter
2.1.315.25** wurden drei synthetische Fälle neu berechnet und vollständig
exportiert. SHA-256 der EXE:
`629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff`.
Die Steuerung erfolgte mit den vorhandenen PowerShell-Oracle-Skripten und
nativen Fenster-/Control-Handles; die tatsächlichen Eingaben wurden visuell
kontrolliert. Die ursprünglichen App-Instanzen wurden nicht verändert.

Gemeinsame Eingaben: EURO-Palette 1200 × 800 mm, Paketbreite 123 mm,
Pakethöhe 143 mm, Abstand 0 mm, Einlaufrichtung längs, Mehrfachgreifen aktiv,
gleiche Lagen. Maße und Einlaufrichtung sind exportverifiziert. Abstand und
Greifoptionen sind UI-Evidenz, da ROB sie nicht vollständig kodiert.
Die Capture-Manifeste bestätigen alle **299 Exporte**. Alle zehn materialisierten
Lagen jedes Exports haben dieselbe physische Grundfläche; der Vergleich der
ersten Lage verliert somit in diesen Fällen keine weitere Lagengeometrie.

| Paketlänge | Desktop-Muster | Direkte Treffer vorher → nachher | Solver-Kandidaten vorher → nachher | Maximalbelegung Desktop / vorher / nachher |
| --- | ---: | ---: | ---: | ---: |
| 176 mm | 100 | 3 → 8 | 1815 → 2315 | 43 / 42 / 43 |
| 177 mm | 100 | 4 → 9 | 1687 → 2187 | 43 / 42 / 43 |
| 178 mm | 99 | 3 → 4 | 2151 → 2651 | 42 / 42 / 42 |

Summe: **10 → 21 von 299** direkt nachgebildeten Desktop-Grundflächen.
Kein bisheriger direkter Treffer ging verloren. Der Fall 178 mm wurde erst
nach den Implementierungsentscheidungen ausgewertet und anschließend nicht
zur weiteren Anpassung verwendet. Die ältere 16-Fälle-Matrix wurde in diesem
Lauf nicht erneut geprüft.

Direkte Treffer nachher, nach Desktop-Exportordinal:

- 176 mm: 1, 2, 3, 4, 30, 31, 97, 98.
- 177 mm: 1, 2, 3, 4, 30, 31, 61, 97, 98.
- 178 mm: 23, 36, 91, 92.

## Vergleichsmethode und Grenzen

Beide Seiten verwenden kanonische Paketmaße. Im Legacy-Parser heißt die
kanonische Länge `package.width`; die Rechteckpositionen sind Mittelpunkte.
Verglichen wurden vollständige physische Rechteckmengen bei **0,500001 mm**
Positionstoleranz, ohne Translation, Spiegelung oder Rotation der Gesamtfläche.
Die Toleranz berücksichtigt die ganzzahlige ROB-Ausgabe; sie wurde nicht zum
Erzielen zusätzlicher Treffer erhöht. Gerichtete Etikettenwinkel,
Greifpartitionen, Griffreihenfolge und Ranking sind hier nicht verifiziert.

Der Vergleich nutzt `candidateEquivalence: "identity"`, das Produktionsbudget
der Regionssuche, 500 Kandidaten je Familie, beide Orientierungen und
`provisionalPackagesPerCycle = floor(450 / Paketlänge)` mit `axis-ends`.
Die Vorher-Auswertung verwendet die bisherige `solve.ts` ohne Aufruf der neuen
Familie; die bestehenden Generatoren sind unverändert. Der Worker verwendet
weiterhin seine bisherige Symmetrie-Zusammenfassung. Die Tabelle beschreibt
deshalb die geometrische Erzeugungsabdeckung im Identitätsmodus, nicht die
Anzahl sichtbarer Karten in der Oberfläche.

Die Suche bleibt begrenzt: 50.000 Arbeitseinheiten für Deskriptorversuche und
materialisierte Paketpositionen sowie das unabhängige Familienlimit. Dichte
Konstruktionen werden zuerst materialisiert. Budgetabbrüche werden als
Diagnose ausgegeben und sind kein Vollständigkeitsnachweis. Beide Achsen und
Spiegelungen entstehen in der Familie, ohne das bisherige Symmetriebudget zu
verbrauchen. Feste Rechteckanforderungen verwenden weiterhin ihre bisherigen
Generatoren.

Die obere Abschlussreihe der Neun-Raster-Treppe kann Aufnahmegruppen kompakt
um den Mittelpunkt der verteilten Einzelpositionen anordnen. Abrunden dieses
Mittelpunktes auf ganze Millimeter ist nur zulässig, wenn die ursprünglichen
Grenzen und sämtliche Mindestabstände erhalten bleiben. Dies ist eine aus den
synthetischen Exporten abgeleitete Konstruktionsregel, keine Aussage über den
internen Quellcode von MultiPack. Positive Abstände und die abschließende
Geometrievalidierung bleiben aktiv.

**278 Desktop-Muster dieser drei Fälle fehlen weiterhin.** Insbesondere
weitere verschachtelte Teilbereiche und deren lokale Abstandsverteilungen sind
offen. Mehr Solver-Kandidaten oder dieselbe Maximalbelegung beweisen keine
identische vollständige Musterliste.

## Verifikation und Datenhaltung

Sieben neue Verhaltenstests prüfen exakte Koordinaten für die neuen
Konstruktionen, freie Kernpositionen, die Abschlussreihe, Mindestabstände,
Familienlimit, Abbruch und Determinismus bei anderer Rotationsreihenfolge und
Progress-Nutzung. Die bestehenden Solver-Tests prüfen zusätzlich globale
Generatorreihenfolge und Progress-Batching.

`bun run check` (ESLint und TypeScript) und `bun run typecheck` sind erfolgreich;
verwendet wurde die im Projekt gepinnte Bun-Version 1.3.14. Der bestehende
55-Pakete-Geometrietest benötigte im gezielten Wiederholungslauf 15,27 Sekunden
und bestand mit unveränderten Zahlenassertionen. Sein bisheriges Zeitlimit von
15 Sekunden wurde auf 30 Sekunden angehoben; das ist keine
Laufzeitoptimierung. Ein erster Gesamtlauf meldete 799 bestandene Tests, diesen
Zeitlimitfehler und einen Vitest-RPC-Timeout und wird nicht als grüner Lauf
gewertet.

Der erneute Gesamtlauf mit JSON-Dateiausgabe hatte keinen gemeldeten RPC-Fehler:
799 Tests bestanden, zwei opt-in Tests wurden übersprungen. Einzig der
Stapeltest mit demselben 55-Pakete-Solverlauf überschritt noch seine eigene
15-Sekunden-Grenze. Auch diese wurde auf 30 Sekunden angehoben. Anschließend
bestand die gesamte betroffene Stapeldatei mit allen fünf Tests; der große
Test benötigte 14,79 Sekunden und bestätigte unverändert 550 Pakete über zehn
Lagen. Damit sind alle 800 aktiven Tests über den Gesamtlauf und die gezielte
Wiederholung abgedeckt. Es gab keinen weiteren vollständigen Lauf nach dieser
letzten reinen Zeitlimitänderung.

Alle Captures und Analyseprogramme verbleiben außerhalb des Repositorys.
Es wurden keine Kundendateien übernommen und keine Corpus-Schutzregeln
geändert. Die Testdaten verwenden unabhängig definierte kleine Geometrien.
Die ROB-Golden-Datei für projektbasierte Exporte erhält explizit LF in
`.gitattributes`, damit Windows-Autocrlf den erwarteten Export nicht verändert.
