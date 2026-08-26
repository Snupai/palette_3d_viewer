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

Die Tabelle und Draufsichten belegen mehrere wiederkehrende, aus den Abmessungen
ableitbare Konstruktionsfamilien. Der Solver implementiert daraus aktuell 19
physisch verschiedene, evidenzabgeleitete Symmetrieklassen:

1. fünf kompakte Vollhöhen-Splits aus zwei oder drei Blöcken (`1164 × 780`);
2. zwei Drei-Block-Splits mit verteilten 12-mm-Blockfugen (`1188 × 780`);
3. ein fünfblöckiges Seitenkern-/Eckbandmuster (`1176 × 780`);
4. ein vierblöckiger C-Rahmen (`1188 × 780`);
5. das symmetrische Capped-Block-Muster (`1188 × 780`);
6. neun dichte `11 × 5`-Raster mit zwei gerichteten Randkerben
   (`1188 × 780`).

Der begrenzte Ziel-Lauf enthält damit 25 finale physische Klassen: die 19 oben
aufgeführten beobachteten Klassen plus sechs weiterhin sichtbare, generische
Mixed-Strip-Geometrien. Diese sechs werden nicht als MultiPack-Parität gewertet.

Die beiden zuvor synthetisch erzeugten Klassen werden eingeschränkt:

- Bei exakten Zwei-Block-Splits werden `center/end`-Ausrichtungen gegenüber der
  kompakten `start`-Konstruktion als topologisch dominiert ausgeschlossen.
  Geometrisch eigenständige generische Mixed-Strips bleiben dagegen sichtbar und
  werden nicht als beobachtete AP5009-Klassen gezählt.
- Gleichorientierte Fünf-Block-Mosaike mit vollständig eingeschlossenen Lücken
  werden nicht mehr als Palettenmuster angeboten; offene Randkerben bleiben
  zulässig.

### Noch nicht als Parität behauptet

- MultiPack zeigt gerichtete Spiegelvarianten separat, während der Solver
  horizontale/vertikale Spiegelung und 180°-Drehung weiterhin zu einer physischen
  Symmetrieklasse zusammenführt. Deshalb sind die 19 Klassen nicht mit 19
  MultiPack-Zeilennummern gleichzusetzen.
- Für die C-Rahmen-, Vollhöhen- und Seitenkernfamilien stimmen die beobachteten
  Blockmaße und provisorischen Zyklen. Bei den Randkerben hängt die beobachtete
  Zykluszahl zusätzlich von der blocklokalen Greifachse und Paarungsphase ab;
  diese Information ist aus der reinen Placement-Geometrie noch nicht eindeutig
  ableitbar.
- Die Screenshots sind Evidenz, aber keine committed Kundenfixture. Exakte
  Candidate-IDs oder Rangnummern sind daher kein Paritätsvertrag.
- Die 19er-Zahl beschreibt die gezielt implementierten beobachteten Klassen,
  keine erschöpfende Enumeration aller generischen Solverfamilien. Die
  experimentellen Corner-Chain-/Offset-Bridge-Suchen erreichen beim Ziel-Input
  weiterhin ihre dokumentierten Arbeitsbudgets; diese Trunkierung wird als
  Diagnose ausgegeben und ist nicht Teil der beobachteten Inventarbehauptung.

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
