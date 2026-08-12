# MultiPack-Paritätskorpus und Scorecard

Stand: 05.08.2026

Der M0-Korpus trennt ausführbare Repository-Baselines von externen Beobachtungen
und offenen Fragen. Er enthält keine privaten Originaldaten. Die
maschinenlesbaren Fälle liegen unter `src/lib/__fixtures__/` und werden über
`src/lib/parityCorpus.ts` statisch entdeckt. Dadurch steht derselbe validierte
Korpus in Vitest und in Anwendungsdiagnosen zur Verfügung; Dateisystemzugriff
oder private lokale Pfade sind kein Bestandteil der Laufzeit-API.

## Evidenzstatus

- **Golden:** anonymisierte oder synthetische Erwartung mit ausführbarer,
  reproduzierbarer Repository-Grundlage;
- **Observed:** dokumentierte Fremdbeobachtung ohne vollständige lokal
  reproduzierbare Evidenz;
- **Open:** Bedeutung, Eingabe oder Erwartungswert ist noch nicht ausreichend
  geklärt.

`Open` kann für nicht anwendbare Dimensionen zusätzlich `applicable: false`
tragen. Ein vorhandener Zahlenwert wird nicht allein durch seine Plausibilität zu
Golden.

## Schemaversionen

- Schema **v1** bleibt als strikter importbezogener Vertrag erhalten.
  `parityGoldenCaseSchema`, `ParityGoldenCase`,
  `PARITY_GOLDEN_CASE_SCHEMA_VERSION` und `evaluateRobGoldenCase` sind weiterhin
  kompatibel.
- Schema **v2** ergänzt Projektinputs, Import-Artefakte, Kandidatenmenge und
  -reihenfolge, frei benannte Metriken, Artefaktverweise, Evidenz je Erwartung und
  alle neun Scorecard-Dimensionen.
- `parityCaseSchema` akzeptiert beide Versionen. Beobachtete Kandidatenquellen mit
  unbekannter Deduplizierung tragen für Identität oder Geometrie ausdrücklich
  `null` statt einer erfundenen Versionszuordnung.

Die Kandidatenverträge sind separat versioniert und in
[docs/CANDIDATE_IDENTITY.md](CANDIDATE_IDENTITY.md) definiert.

## Versionierter Referenzkorpus

| Fall                           | Herkunft                 | Ausführbare Grundlage                  | Kernerwartungen                                                 |
| ------------------------------ | ------------------------ | -------------------------------------- | --------------------------------------------------------------- |
| Anonymized ROB import baseline | anonymisiert/synthetisch | LF- und CRLF-`.rob`-Fixture, Schema v1 | Importzusammenfassung und semantischer Roundtrip                |
| Synthetic alternating stack    | synthetisch              | committed `.rob`, Schema v2            | 2 Muster, 4 Lagen, 14 Packstücke, 8 Zyklen, Zwischenlagen       |
| Synthetic square grid          | synthetisch              | inline `ProjectV2`, Schema v2          | zwei geordnete 12er-Kandidaten; Orientierung bleibt verschieden |
| Synthetic identity variants    | synthetisch              | inline `ProjectV2`, Schema v2          | eine Geometrie, drei Identitäten durch Etikett/Greifpartition   |
| AP5006 / 1329-00004 observed   | MultiPack-Beobachtung    | keine committed Originaleingabe        | 65 gesamt, 15 mit 55 und weitere beobachtete Zielwerte          |

Damit enthält der Korpus vier klar anonymisierte beziehungsweise synthetische
Referenzen und einen getrennten Observed-Fall. Die synthetischen Werte sind
Verträge dieses Projekts und werden nicht als reproduzierte MultiPack-Ausgaben
ausgegeben.

## Paritätsmatrix

Die JSON-Scorecards sind die maßgebliche, maschinenlesbare Quelle. Diese Tabelle
ist ihre kompakte Zusammenfassung.

| Fall                        | Eingabe  | Geometrie | Vielfalt | Ranking  | Stapel   | Robotik  | Export   | Bedienung | Performance |
| --------------------------- | -------- | --------- | -------- | -------- | -------- | -------- | -------- | --------- | ----------- |
| Anonymized ROB import       | Golden   | Golden    | Open n/a | Open n/a | Golden   | Golden   | Golden   | Open n/a  | Open n/a    |
| Synthetic alternating stack | Golden   | Golden    | Open n/a | Open n/a | Golden   | Golden   | Golden   | Open n/a  | Open n/a    |
| Synthetic square grid       | Golden   | Golden    | Golden   | Golden   | Open n/a | Open n/a | Open n/a | Open n/a  | Open n/a    |
| Synthetic identity variants | Golden   | Golden    | Golden   | Golden   | Open n/a | Open     | Open n/a | Open n/a  | Open n/a    |
| AP5006 / 1329-00004         | Observed | Observed  | Observed | Open     | Observed | Observed | Open     | Observed  | Open        |

## Corpus- und Diagnose-APIs

`src/lib/parityCorpus.ts` exportiert:

- `discoverParityCorpus`: validiert beliebige öffentliche Dokumentquellen,
  meldet exakte Zod-Pfade sowie doppelte Case-IDs und sortiert deterministisch;
- `loadBuiltInParityCorpus`: lädt den statisch importierten Repository-Korpus;
- `evaluateParityCase`: vergleicht eine Import-, Kandidaten- oder
  Metrikbeobachtung mit einem Fall;
- `runParityCorpus`: führt einen synchronen oder asynchronen Adapter über alle
  Fälle aus, ohne selbst private Dateien zu suchen;
- `aggregateParityResults`: aggregiert Mismatches, Golden-Regressionen,
  nicht ausgeführte Checks und Statuszahlen je Scorecard-Dimension;
- `collectExpectedParityMismatches`: liefert exakte Pfade für partielle
  v2-Erwartungen; der bestehende exakte v1-Vergleich bleibt separat erhalten.

Eine Anwendung kann aktuelle Solver-/Projektwerte direkt als Observation
übergeben. Vitest kann committed Artefakte über `node:fs` laden. Der gemeinsame
Produktionscode importiert dagegen kein Node-Dateisystem und kennt keine lokalen
Produktionsordner.

## AP5006 / 1329-00004 – beobachtete Zielwerte

Diese Werte stammen aus der bisherigen Rebuild-Beobachtung. Sie werden erst zu
Golden Gates, wenn Eingabe und relevante Ausgaben vollständig anonymisiert und
lokal reproduzierbar sind.

| Dimension              | Beobachtung                              |
| ---------------------- | ---------------------------------------- |
| Packstück              | 157 × 106 × 150 mm, Quader, Abstand 0 mm |
| Palette                | EURO 1200 × 800 mm                       |
| Nutzbarer Block        | Unterhang Länge −34 mm, Breite −11 mm    |
| Solvermenge            | 65 Pläne insgesamt                       |
| Relevante Menge        | 15 Pläne mit jeweils 55 Packstücken      |
| Sichtbare Zykluszahlen | 33 oder 36                               |
| Sichtbare Blockmaße    | Länge 1162–1166 mm, Breite 785–789 mm    |
| Ausgewählter Kandidat  | 55 Packstücke, 33 Zyklen, 1166 × 785 mm  |
| Beispielstapel         | 10 Lagen, 550 Packstücke, Höhe 1500 mm   |
| Auslastung             | etwa 95 % Fläche und 86 % Volumen        |

Ein lokal inspizierter Export enthielt je Muster 55 Packstücke in 36 Zyklen und
19 Doppel- sowie 17 Einzelgriffe. Weil diese Produktionsdatei bewusst nicht
committed und nicht durch den Corpus-Runner aufgelöst wird, bleiben auch diese
Zahlen **Observed**. Insbesondere sind weder die 65 Kandidaten noch deren
Identitätssemantik oder Reihenfolge unter dem neuen v1-Vertrag belegt.

## Artefakt- und Provenienzregeln

- Repository-Artefakte verwenden ausschließlich relative POSIX-Pfade.
- Externe oder fehlende Artefakte dürfen keinen lokalen Pfad enthalten und werden
  nicht automatisch aufgelöst.
- Jeder Evidenzverweis muss auf eine im selben Fall deklarierte Artefakt-ID
  zeigen.
- Synthetische Werte nennen ausdrücklich, dass sie keine MultiPack-Provenienz
  besitzen.
- Screenshots, Exporte oder `.mpb`-Dateien werden nur als Golden referenziert,
  wenn eine anonymisierte Datei tatsächlich committed und im Test nutzbar ist.

## Noch benötigte Evidenz

1. vollständige anonymisierte AP5006-Eingabe;
2. Placement-Geometrie aller 65 Kandidaten oder mindestens der 15 55er-Muster;
3. stabile Reihenfolge und vollständige Werte der Lösungstabelle;
4. kontrollierte `.rob`-Exportpaare für `dx`/`dy`, Etikett, Greifgruppe,
   Einlaufrichtung und Palettierrichtung;
5. ein gespeicherter Stapel mit Zwischenlagen und abweichender oberer Lage;
6. anonymisierte `.mpb`-Dateien mit kontrollierten Einzeländerungen.

Der aktuelle Forschungsstand, einschließlich „Blöcke“, Vorzeichen und `.mpb`,
steht im datierten
[Research-Log vom 05.08.2026](research/2026-08-05-parity-research-log.md).
