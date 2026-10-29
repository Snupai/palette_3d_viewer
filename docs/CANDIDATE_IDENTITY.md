# Kandidatenidentität und geometrische Gleichheit

Stand: 14.08.2026

Diese Definition gilt für den Referenzkorpus und den späteren Solver. Sie trennt
zwei Fragen, die nicht miteinander verwechselt werden dürfen:

1. Liegen dieselben Packstücke an denselben Stellen? Das ist **geometrische
   Gleichheit**.
2. Beschreiben zwei Kandidaten zusätzlich denselben etiketten- und
   greiftechnischen Plan? Das ist **Kandidatenidentität**.

Die Verträge sind unabhängig versioniert:

- `CANDIDATE_GEOMETRY_EQUALITY_VERSION = 1`
- `CANDIDATE_IDENTITY_VERSION = 1`

Die ausführbaren Definitionen stehen in
`src/domain/solver/candidateIdentity.ts`. Jeder Golden Case mit
Kandidatenerwartungen nennt beide Versionen ausdrücklich. `null` bedeutet bei
einer beobachteten Fremdquelle, dass deren Identitäts- oder
Deduplizierungsregeln unbekannt sind.

## Geometrische Gleichheit v1

Für jedes Packstück wird das Tupel

```text
(x-Mittelpunkt, y-Mittelpunkt, Orientierung)
```

gebildet. Zwei Kandidaten sind genau dann geometrisch gleich, wenn ihre sortierten
Tupelmengen exakt gleich sind.

Dabei gilt bewusst:

- Koordinaten werden exakt verglichen; es gibt keine Rundung oder Toleranz.
- `0°`, `90°`, `180°` und `270°` bleiben verschieden, auch bei quadratischen
  Packstücken. Orientierung kann später Etiketten- oder Greifbedeutung tragen.
- Lokale Placement-IDs, Array-Reihenfolge, Etiketten und Greifgruppen werden für
  diese eine Relation ignoriert.
- Verschiebung, Spiegelung, Palettenrotation und andere Symmetrien werden nicht
  automatisch gleichgesetzt.
- Gleiche Geometrie behauptet ausdrücklich **keine** gleiche robotische
  Ausführbarkeit.

Diese enge Definition verhindert, dass der Solver echte Varianten durch eine
ungeklärte Symmetrie- oder Etikettenannahme entfernt.

## Grundlayout-Auswahlklassen

Der finale Solver-Kandidatenindex fasst zusätzlich Varianten zusammen, die der
Bediener pro physischer Stacklage selbst einstellen kann. Diese Auswahlpolicy ist
bewusst **keine** Änderung an geometrischer Gleichheit v1 oder
Kandidatenidentität v1.

Für jeden validierten Placement-Satz wird über alle den Generierungsrahmen
erhaltenden Spiegelungen und Drehungen ein kanonischer Grundlayout-Key gebildet.
Für diesen Auswahl-Key gilt:

- `0°` und `180°` beschreiben denselben physischen Paket-Footprint;
- `90°` und `270°` beschreiben denselben physischen Paket-Footprint;
- bekannte Etikettenseiten werden mit der globalen Transformation mitgeführt und
  bleiben Teil des Keys;
- ein nicht durch den Symmetriegenerator erzeugter Basis-Draft wird als
  gerichteter Repräsentant bevorzugt;
- weitere Generator- und Symmetrie-Provenienzen werden am Repräsentanten
  zusammengeführt.

Der gewählte Repräsentant behält seinen exakten gerichteten
`geometryFingerprint`, seine `candidateIdentityFingerprint` und seinen daraus
abgeleiteten Grip-Plan. Spiegelung an Palettenlänge oder -breite und eine
180°-Drehung werden stattdessen pro einzelner physischer Lage im Stack-Builder
gewählt; beim Materialisieren wird dafür die gerichtete Geometrie samt Grip-Plan
neu abgeleitet.

## Kandidatenidentität v1

Die Identität enthält die geometrischen Tupel und zusätzlich alle bekannten
operativen Angaben:

- bekannte Placement-/Ablaufreihenfolge;
- Etikettenseite je Packstück;
- Zuordnung und Partition der Packstücke in Greifgruppen;
- bekannte Greifreihenfolge;
- Pick- und Place-Koordinaten samt Orientierung;
- Packstückzahl je Griff;
- die unveränderten `dx`-/`dy`-Werte.

Lokale IDs werden über Geometrie und Gruppenmitgliedschaft kanonisiert. Das
Umbenennen einer Placement- oder Grip-ID sowie eine andere Array-Reihenfolge
ändern die Identität daher nicht.

Unbekanntes wird konservativ behandelt:

| Zustand                       | Bedeutung                                      |
| ----------------------------- | ---------------------------------------------- |
| Feld fehlt                    | unbekannt                                      |
| `null`                        | ausdrücklich keine Zuordnung/kein Etikett      |
| konkreter Wert                | bekannte operative Aussage                     |
| Grip-Referenz ohne Definition | ungelöste Referenz; nicht still gleichzusetzen |
| fehlendes `grips`             | Greifdefinitionen unbekannt                    |
| `grips: []`                   | Greifdefinitionen nachweislich leer            |

„Unbekannt“ ist nicht gleich „keins“. Ebenso bleiben gleiche Geometrien mit
abweichendem Etikett, anderer Greifpartition oder anderer bekannter Reihenfolge
verschiedene Kandidatenidentitäten.

## Fingerprints und kompakte IDs

Die kanonischen Fingerprints enthalten den vollständigen versionierten Inhalt.
Für Tabellen und Fixtures wird daraus zusätzlich eine kompakte 64-Bit-FNV-1a-ID
erzeugt:

```text
candidate-v1-<16 Hexzeichen>
geometry-v1-<16 Hexzeichen>
```

Der vollständige Fingerprint ist die maßgebliche Vergleichsgrundlage. Falls
jemals eine Hash-Kollision festgestellt wird, dürfen zwei Kandidaten nicht
zusammengeführt werden; zuerst sind die vollständigen Fingerprints zu vergleichen
und anschließend ist das ID-Verfahren kontrolliert zu versionieren.

## Versionsregel

Eine Version muss erhöht werden, wenn eine Änderung bestehende Fingerprints oder
die Bedeutung von Gleichheit verändern kann, zum Beispiel durch:

- Koordinatentoleranzen oder Quantisierung;
- Gleichsetzung von `0°` und `180°`;
- neue Symmetrie- oder Spiegelregeln;
- Aufnahme oder Entfernung von Etiketten-, Reihenfolge- oder Greifdaten;
- geänderte Behandlung unbekannter Felder.

Eine neue Version ersetzt alte Corpus-Werte nicht still. Golden Cases werden
explizit migriert oder behalten ihre bisherige Version, damit Solveränderungen
vergleichbar bleiben.
