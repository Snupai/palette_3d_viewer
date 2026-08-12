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

**Status: Open**

### Evidenz

- Die beobachtete Lösungstabelle besitzt laut Roadmap eine Spalte „Blöcke“.
- Im Repository liegt weder eine vollständige Kandidatentabelle noch eine
  ausführbare MultiPack-Regel oder ein kontrolliertes Vergleichspaar vor.

### Belastbare Aussage

Der Wert darf derzeit nicht als Anzahl zusammenhängender Rechteckbereiche,
Reihen, Orientierungskomponenten, Greifgruppen oder Stabilitätsblöcke
implementiert werden. Jede dieser Deutungen wäre eine unbestätigte Hypothese.

### Nächster Nachweis

Mehrere geometrisch kontrollierte Kandidaten mit jeweils nur einer Änderung
(Reihe teilen, Orientierung wechseln, Zwischenraum einfügen, Greifgruppe ändern)
und dem dazu angezeigten „Blöcke“-Wert erfassen.

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
