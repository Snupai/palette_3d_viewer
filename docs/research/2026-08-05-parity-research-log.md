# Paritäts-Research-Log – 05.08.2026

Dieses Log trennt nachprüfbare Repository-Evidenz von externen Beobachtungen und
offenen Hypothesen. Es enthält keine privaten Produktionsdateien. Neue Erkenntnisse
werden datiert ergänzt; bestehende Einträge werden nicht rückwirkend zu „Golden“
erklärt.

## Verwendete Evidenz am 05.08.2026

- ausführbarer Parser/Serializer und Tests in `src/lib/robParser.ts`;
- aktuelle Geometrieabbildung in `src/domain/palletGeometry.ts`;
- AP5006-Zusammenfassung in `docs/PARITY.md`;
- Meilenstein- und Forschungsfragen in `ROADMAP.md`;
- synthetische/anonymisierte Fixtures unter `src/lib/__fixtures__/`.

Die lokal erwähnte Produktionsdatei `1329-00004.rob` ist nicht Teil des
Repositories und wird von keinem Corpus-Lauf benötigt.

## „Blöcke“-Semantik

**Status: teilweise Observed; allgemeine Zählregel bleibt Open**

### Evidenz

- Die beobachtete Lösungstabelle besitzt laut Roadmap eine Spalte „Blöcke“.
- Am 25.08.2026 wurde „Block“ aus der MultiPack-Bedienpraxis als ein
  ununterbrochener Paketbereich beschrieben, in dem alle Pakete gleich angeordnet
  sind.
- Das gleichzeitig bereitgestellte 53er-Muster mit 156 × 108 mm großen Paketen
  zerfällt passend dazu in vier einheitliche Rechteckbereiche: `11 × 2` oben und
  unten `2 × 4 | 5 × 3 | 2 × 4`.
- Im Repository liegt weiterhin weder eine vollständige Kandidatentabelle noch
  eine ausführbare MultiPack-Zählregel oder eine kontrollierte Serie von
  Vergleichspaaren vor.

### Belastbare Aussage

Für generatorbekannte Topologien darf die Anzahl ihrer ununterbrochenen,
einheitlich orientierten Rechteckbereiche als Konstruktionsmetadatum festgehalten
werden. Das neue symmetrische Capped-Block-Muster besitzt danach vier Blöcke.

`CandidateMetrics.multiPackBlocks` bleibt dennoch `null`: Noch ungeklärt ist, wie
MultiPack beliebige Geometrien maximal zerlegt, insbesondere bei verteilten
Zwischenräumen, gleich orientierten angrenzenden Bereichen und unterbrochenen
Reihen. Der Wert darf daher noch nicht allgemein aus Placements inferiert oder im
Ranking verwendet werden.

### Nächster Nachweis

Mehrere geometrisch kontrollierte Kandidaten mit jeweils nur einer Änderung
(Reihe teilen, Orientierung wechseln, Zwischenraum einfügen, Greifgruppe ändern)
und dem dazu angezeigten „Blöcke“-Wert erfassen, um die maximale Zerlegung und
Grenzfälle der Zählregel zu bestimmen.

## AP5009: beobachtetes 53er-Kandidateninventar

**Status: Geometrien teilweise Observed; gerichtete Spiegelvarianten und
blocklokale Greifplanung bleiben Open**

### Eingabe und neue Evidenz

Am 26.08.2026 wurden MultiPack-Screenshots der Lösungen 15 sowie 17–36 für
folgende Eingabe bereitgestellt:

- Projekt `AP5009`, Produkt `699-00224`;
- Paket `156 × 108 × 53 mm`, Abstand `0 mm`;
- effektiver Generierungsrahmen `1188 × 780 mm`;
- exakt 53 Pakete je Lage und Mehrfachgreifen aktiviert.

Die Screenshots lieferten zunächst 19 physische Symmetrieklassen. Die spätere
Stabilitätsbewertung vom 26.08.2026 schränkt die produktive Auswahl jedoch auf
**sieben saubere Blockmuster** ein:

1. ein kompakter Zwei-Block-Split (`1164 × 780`) und vier bündige
   Drei-Block-Splits (`1188 × 780`); der Höhenrest liegt gleichmäßig zwischen den
   Paketzeilen, der Längenrest vollständig innerhalb des Mittelblocks;
2. ein vierblöckiger C-Rahmen (`1188 × 780`), dessen Kern sowohl horizontal als
   auch vertikal bündig verteilt ist;
3. das symmetrische Capped-Block-Muster (`1188 × 780`), bei dem die 24 mm
   Kernrestmaß innerhalb der fünf Kernspalten statt als zwei äußere Fugen liegen.

Für exakte produktive Läufe gelten damit folgende Regeln:

- `center/end`-Ausrichtungen eines Zwei-Block-Splits werden gegenüber der
  kompakten `start`-Konstruktion als topologisch dominiert ausgeschlossen.
- Alternierende beziehungsweise versetzte Mixed-Strips werden nicht angeboten;
  nur gruppierte, bündige Blockreihen bleiben produktiv.
- Gleichorientierte Fünf-Block-Mosaike mit fehlenden Rasterzellen werden
  verworfen.
- Drei-Block-Muster mit zusätzlichen Zwischenblockfugen,
  Seitenkern-/Eckbandmuster mit einer einzelnen großen Innenfuge und
  Edge-Notch-Raster sind nur noch über den expliziten internen
  `includeExperimentalIncompleteBlocks`-Hook für Forschungstests erreichbar.

### Noch nicht als Parität behauptet

- MultiPack zeigt gerichtete Spiegelvarianten separat, während der Solver
  horizontale/vertikale Spiegelung und 180°-Drehung weiterhin zu einer physischen
  Symmetrieklasse zusammenführt.
- Die Screenshots sind Evidenz, aber keine committed Kundenfixture. Exakte
  Candidate-IDs oder Rangnummern sind daher kein Paritätsvertrag.
- Die sieben produktiven Klassen sind eine stabilitätsorientierte Auswahl, keine
  erschöpfende Enumeration aller generischen Solverfamilien. Experimentelle
  Corner-Chain-/Offset-Bridge-Suchen dürfen weiterhin ihre dokumentierten
  Arbeitsbudgets erreichen und dies diagnostizieren.

## Unbekannte oder nur teilweise verstandene `.rob`-Felder

**Status: teilweise Golden für Syntax, Open für Fremdsemantik**

### Evidenz

Der aktuelle Parser liest pro Zykluszeile genau neun ganzzahlige Werte:

```text
pickX pickY pickRotation placeX placeY placeRotation numPackages dx dy
```

Syntax, erlaubte Rotationen, Paketanzahl, Layerzuordnung und semantischer
Repository-Roundtrip sind durch synthetische Fixtures abgedeckt.

### Offene Semantik

- Ob die ersten beiden Werte immer denselben Pick-TCP-Ursprung verwenden.
- Ob Pick- und Place-Winkel in allen Greifer-/Stationskonfigurationen dieselbe
  positive Drehrichtung besitzen.
- Ob `dx`/`dy` ausschließlich Etikett-/Anlegeseiten, zusätzlich
  Platzierungsabhängigkeiten oder weitere Robotikregeln kodieren.
- Welche Wertebereiche außer den bisher beobachteten Vorzeichen praktisch
  zulässig sind.

Der Serializer bewahrt bekannte Werte, behauptet daraus aber noch keine
MultiPack-kompatible Neuberechnung.

## Solverabweichungen

**Status: Observed-Ziel, noch kein ausführbarer Fremdvergleich**

### Evidenz

Für AP5006 / 1329-00004 sind 65 Kandidaten insgesamt, 15 Kandidaten mit 55
Packstücken sowie sichtbare Zyklus- und Blockmaßbereiche dokumentiert. Es fehlen
die vollständige anonymisierte Eingabe, alle Placement-Geometrien und die stabile
Reihenfolge.

### Arbeitsregel

- `55` Packstücke ist ein späteres Ziel, noch kein M0-Solver-Gate.
- `65 gesamt / 15 mit 55` bleibt Observed, bis derselbe anonymisierte Input lokal
  ausführbar ist und die Identitätsregeln der Quelle ausreichend geklärt sind.
- Künftige Solverläufe melden Anzahl, Maximum, Gleichheitsversion,
  Kandidatenreihenfolge und exakte Mismatch-Pfade getrennt. Eine zufällige
  Übereinstimmung einzelner Summen genügt nicht.

## Etikettenregeln

**Status: Open für MultiPack, Golden für Corpus-Identität v1**

### Evidenz

`parseBlueLine` bildet `dx`/`dy` im aktuellen Viewer auf Seiten oder Ecken ab.
Ein kontrolliertes MultiPack-Exportpaar, bei dem ausschließlich die
Etikettenseite geändert wurde, fehlt.

### Arbeitsregel

- Orientierung bleibt selbst bei quadratischen Packstücken geometrisch relevant.
- Bekannte Etikettenseiten sind Bestandteil der Kandidatenidentität v1.
- Fehlendes Etikettwissen und explizit `null` werden nicht gleichgesetzt.
- Geometrische Gleichheit ignoriert Etiketten nur als engere
  Deduplizierungsansicht; sie behauptet keine operative Austauschbarkeit.

Details und Versionsregeln stehen in `docs/CANDIDATE_IDENTITY.md`.

## Vorzeichenkonventionen

**Status: Golden als heutiges Repository-Verhalten, Open als externe Bedeutung**

Die aktuelle Zuordnung in `parseBlueLine` lautet:

| Bedingung          | Viewer-Seite/-Ecke |
| ------------------ | ------------------ |
| `dx = 0`, `dy > 0` | `bottom`           |
| `dx = 0`, `dy < 0` | `top`              |
| `dx > 0`, `dy = 0` | `left`             |
| `dx < 0`, `dy = 0` | `right`            |
| `dx > 0`, `dy > 0` | `bottom_left`      |
| `dx > 0`, `dy < 0` | `top_right`        |
| `dx < 0`, `dy > 0` | `bottom_right`     |
| `dx < 0`, `dy < 0` | `top_left`         |

Der 2D-Editor zeichnet den Abhängigkeitspfeil mit einer eigenen
Bildschirmachsenabbildung (`-dx`, `+dy`). Diese beiden Implementierungsdetails
sind getestet beziehungsweise direkt im Code sichtbar, aber noch keine
Bestätigung der ursprünglichen MultiPack- oder Roboterkoordinatenkonvention.

### Nächster Nachweis

Kontrollierte Exporte für jede Achse und Ecke erzeugen, jeweils mit identischer
Geometrie und nur einer geänderten Etikett-/Anlegeseite. Dazu Pick-/Place-TCP und
sichtbare UI-Markierung gemeinsam protokollieren.

## `.mpb`-Formatevidenz

**Status: Open**

### Evidenz

Im Repository existieren am 05.08.2026:

- keine anonymisierte `.mpb`-Fixture;
- keine bestätigte Magic Number oder Versionssignatur;
- keine Feldtabelle;
- kein Parser und kein Writer;
- keine Roundtrip- oder Fremdkompatibilitätsprüfung.

Die Roadmap nennt lediglich einen optionalen, ausschließlich lesenden Import für
sicher dekodierte Format-v1-Felder. Das ist ein Ziel, keine Formatevidenz.

### Arbeitsregel

- Kein `.mpb`-Writer ohne vollständig verstandene Felder und echte
  Kompatibilitätstests.
- Ein späterer Reader muss unbekannte Bytes/Felder sichtbar kennzeichnen und darf
  sie nicht aus Dateinamen oder UI-Beobachtungen erraten.
- Erste belastbare Schritte sind anonymisierte, rechtmäßig verfügbare Dateien mit
  kontrolliert jeweils einer Änderung, Header-/Offsetvergleich und dokumentierte
  Versionssignaturen.

## Offene nächste Experimente

1. AP5006-Eingabe und mindestens die 15 beobachteten 55er-Geometrien vollständig
   anonymisieren.
2. Kandidatentabelle inklusive Reihenfolge, „Blöcke“, Zyklen und Blockmaßen
   maschinenlesbar erfassen.
3. `.rob`-Exportpaare für `dx`, `dy`, Etikett, Einlaufrichtung und
   Palettierrichtung erzeugen.
4. Eine anonymisierte `.mpb`-Dateiserie mit kontrollierten Einzeländerungen
   bereitstellen, bevor Parserarbeit beginnt.

## Ergänzung 02.09.2026 – vollständiger 201 × 139-mm-Oracle-Capture

**Status: Observed; externe hash-only Evidenz, nicht committed**

Die laufende Referenz wurde als native x86-Delphi-Anwendung
`MULTIPACK für Roboter` mit Dateiversion `2.1.315.25` und EXE-SHA-256
`629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff`
identifiziert. Der Windows-only Capture-Runner erfasste für 201 × 139 × 231 mm,
Abstand 0 und eine 1200 × 800-mm-EURO-Palette alle Kandidaten in der
DevExpress-Lösungsliste. Die externe Ablage enthält ausschließlich synthetisch
benannte Exporte und ein Manifest ohne absolute Pfade oder Rohtext.

### Kandidatenmenge

- vollständige Lösungsliste: exakt 87 Kandidaten;
- alle 87 Einzel-`.rob`-Exporte parsergültig und manifest-hashgleich;
- alle 87 Byte-Digests unterschiedlich;
- Paketanzahl je Lage: 7 × 31, 25 × 30, 15 × 29, 15 × 28, 11 × 27,
  8 × 26, 4 × 25 und 2 × 24;
- Zyklen je Lage: 1 × 31, 3 × 28, 4 × 27, 2 × 26, 1 × 25, 5 × 24,
  9 × 23, 15 × 22, 9 × 21, 9 × 20, 3 × 19, 12 × 18, 3 × 17,
  6 × 16, 4 × 15 und 1 × 13.

Die Eingabe „31 Packstücke“ beschränkt MultiPack demnach nicht auf exakte
31er-Muster. MultiPack erzeugt und sortiert zusätzlich schwächer belegte
Lösungen bis 24 Packstücke. Die sechs im ursprünglichen Viewport sichtbaren
Zeilen waren nur ein Ausschnitt; die siebte 31er-Lösung lag bereits unterhalb
des sichtbaren Bereichs.

### Sieben 31er-Kandidaten

| Ordinal | Zyklen | geparste Außenmaße in mm |
| ------: | -----: | -----------------------: |
|       1 |     22 |               1159 × 757 |
|       2 |     27 |             1174,5 × 757 |
|       3 |     26 |             1174,5 × 757 |
|       4 |     31 |               1174 × 757 |
|       5 |     24 |               1174 × 757 |
|       6 |     23 |               1174 × 757 |
|       7 |     23 |               1174 × 757 |

Ordinal 4 ist das im Screenshot ausgewählte Muster mit 31 Zyklen. Die
halben Millimeter bei Ordinal 2 und 3 stammen aus den geparsten
Paketmittelpunkten; die Desktop-Tabelle zeigt gerundete Blockmaße.

### Aktuelle Solver-Abdeckung

Ein differentieller Lauf mit der tatsächlichen Website-Konfiguration
(`compact-centered`, gemischte Orientierungen, exakte Quell-Paketanzahl je
Vergleich) repräsentierte physisch nur 4 der 87 Legacy-Kandidaten: Ordinal 8,
53, 82 und 86. Keiner der sieben 31er-Kandidaten wurde geometrisch getroffen.
Die derzeit angezeigten drei 31er-Solver-Kandidaten besitzen deshalb trotz
teilweise gleicher Außenmaße nicht dieselbe Paketgeometrie wie die Legacy-
Lösungen.

### Verbleibend Open

- `Blöcke` ist noch nicht maschinenlesbar erfasst und bleibt unverified;
- die vollständige Tabellenmetrik neben den `.rob`-abgeleiteten Zyklen und
  Außenmaßen fehlt;
- die 83 nicht repräsentierten Geometrien müssen zunächst nach Topologie
  klassifiziert werden, bevor neue deterministische Generatorfamilien entstehen;
- der externe Capture bleibt Observed, bis daraus kontrollierte synthetische
  Golden-Fälle abgeleitet werden, ohne Produktionsdaten zu übernehmen.

## Ergänzung 07.09.2026 – erneute Desktop-Erfassung

**Status: Observed; synthetische externe Captures, keine Kundenfixtures.**

Die installierte EXE und eine neue beschreibbare Kopie wurden erneut mit
Dateiversion `2.1.315.25` und dem dokumentierten SHA-256 geprüft. Der Referenzfall
`201 × 139 × 231 mm`, EURO-Palette und Abstand 0 erzeugte erneut genau 87
vollständig exportierte, parsergültige und hashgeprüfte Kandidaten. Die
Paketanzahlverteilung entspricht der Erfassung vom 02.09.2026.

Die historische Bezeichnung „Eingabe 31 Packstücke“ ist dabei **nicht erneut als
Eingabeeinstellung bestätigt** worden: Der tatsächlich bediente Dialog
„Palettenbeladung – Eingabe“ enthielt kein Stückzahlfeld. Ohne eine eingegebene
Sollstückzahl erschienen sieben 31er-Lösungen sowie weitere Lösungen mit 24–30
Paketen. Neue Manifeste führen `requestedPackagesPerLayer: null`. Aus diesem
Versuch folgt weder eine exakte noch eine maximale Bedeutung eines anderen,
möglicherweise vorhandenen Stückzahlparameters.

Beim kontrollierten Versuch `199 × 200 mm` meldete MultiPack ausdrücklich
„Packstücklänge und -breite vertauscht“. Die tatsächliche Erfassung verwendet
deshalb `200 × 199 mm`; angeforderte und exportierte Maße dürfen hier nicht
gleichgesetzt werden.

Der aktuelle Solver besitzt zusätzliche Regionengeneratoren. Alte
Abdeckungszahlen dürfen nicht fortgeschrieben werden. Der explizite
`candidateEquivalence: "identity"`-Vergleichsmodus erhält gerichtete
Kandidatenidentitäten und berücksichtigt Regionendrafts bei der
Symmetrieerzeugung. Er ist kein behaupteter MultiPack-Algorithmus; die bisherige
produktive Symmetriezusammenführung bleibt der Standard. Suchbudgetabbrüche
werden nun auch für Regionensuchen im Paritätsreport als unvollständig erfasst.

Die vollständige neue Matrix mit zehn Fällen und 554 Einzel-Exporten,
getrennten freien und stückzahlgebundenen Vergleichen, Teilprüfungen der
Greifoperationen und den verbleibenden Grenzen steht im
[Liveparitätsbericht vom 07.09.2026](2026-09-07-multipack-live-parity.md).

## Ergänzung 08.09.2026 – Neustart und Suchbudget

Ein Lauf mit zehn leeren Paletten wurde ausgeschlossen. Nach Neustart der
isolierten, erneut buildgeprüften Kopie lieferten sowohl 201 × 139 als auch
203 × 139 mm je 87 vollständig validierte Exporte. Die Referenzgrundflächen
stimmen an allen Listenpositionen mit dem Vortag überein, gerichtete Winkel
und vollständige Griffdaten dagegen nicht. Die Sitzungen dürfen daher nicht
operativ gleichgesetzt werden.

Die Regionensuche verteilt ihr unverändertes Budget nun über dichte Zielzahlen
ab der größten katalogisierten Rasterbelegung (Arbeitsmodell 9). Die bisherige
Zehn-Fälle-Matrix und ein neuer Nachbarfall wurden dagegen geprüft. Einzelheiten,
verworfener Vorversuch, Exportkorrektur und Aussagegrenzen stehen im
[Fortsetzungsbericht vom 08.09.2026](2026-09-08-multipack-live-parity.md).


## Ergänzung 08.09.2026 – Asymmetrische Pinwheels und Etiketten

Freie Stückzahlsuche erzeugt nun auch asymmetrische Pinwheels, kompakte Restabstände zwischen Eckblöcken und die transponierte Achse. Die vollständige 13-Läufe-Matrix sowie verworfene Erweiterungen stehen im [aktuellen Bericht](2026-09-08-multipack-live-parity.md). Im getrennten Identitätsvergleich steigt die Referenz von 5 auf 8 direkte Grundflächentreffer; 203 × 139 bestätigt denselben Gewinn. Der Projektadapter übernimmt ein einzelnes Etikettenfeld. Die positive Achse bei Entfernungs-Gleichstand wurde auf beiden Achsen kontrolliert. Winkelgleichheit auf vorgegebenen Oracle-Grundflächen bleibt strikt von Mustererzeugung getrennt. Keine vollständige Parität; Corpus-Gates unverändert.

## Ergänzung 08.09.2026 – 16 zusätzliche Kartonmaße und Greifpartitionen

Alle 16 zusätzlich genannten Kartonmaße wurden in der vorhandenen isolierten Instanz von Build 2.1.315.25 geprüft: 1068 vollständig validierte Kandidaten. Die Restgruppenregel für das unveränderte MultiPack-Greiferprofil bei Einlauf längs verbessert passende Greifpartitionen von 57 auf 80 und gemeinsame operative Teiltreffer von 54 auf 64; die 81 direkten Grundflächentreffer bleiben unverändert. Automatische Dreiergriffe für kurze Kartons sind jetzt auch in Bedienung und Robotics verfügbar. Der [vollständige Fallbericht](2026-09-08-multipack-user-cartons.md) enthält Vorher/Nachher, Verteilungen, Zusatzkandidaten, Rangprüfungen, Suchbudgetgrenzen und die erfolgreiche Wiederaufnahme des letzten Captures. Gesamtsuite: 790 bestanden, zwei übersprungen. Keine vollständige Parität; Corpus-Gates unverändert.
