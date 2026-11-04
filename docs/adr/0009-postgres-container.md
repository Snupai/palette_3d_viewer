# PostgreSQL im Container statt SQLite-Datei

Ersetzt [ADR 0001](0001-local-sqlite-server.md).

Die servergestützte Version speichert ihre Daten in PostgreSQL, das als Container über eine `compose.yaml` im Repository gestartet wird. Die Datei funktioniert unverändert mit Docker Compose und Podman (`podman compose`, auch rootless); Images werden deshalb voll qualifiziert angegeben (z. B. `docker.io/library/postgres:17`) und auf eine Hauptversion fixiert. Die Daten liegen in einem benannten Volume, der Datenbankport ist nur auf dem Host bzw. im Compose-Netz erreichbar und nicht im Werksnetz. Die App verbindet sich über `DATABASE_URL`; `PALETTE_DB_PATH` entfällt. Damit ist die Datenbank mit einem Befehl reproduzierbar startbar, unabhängig vom Dateisystem des Hosts, und echte Transaktionen und Sperren stehen für die atomare Versionsprüfung ([ADR 0006](0006-optimistic-concurrency.md)) zur Verfügung.

Weiterhin gilt ein einzelner Host im Werksnetz ohne verteilte Schreibinstanzen oder Replikation. Drizzle bleibt Schema-, Migrations- und Abfrageschicht; die generische JSON-Datensatztabelle nach [ADR 0004](0004-generic-planner-records.md) nutzt `jsonb`. Ob auch die App selbst als Container ausgeliefert wird, ist nicht Teil dieser Entscheidung.

Automatisierte Tests dürfen keinen laufenden Container voraussetzen: Server-Tests laufen in der Node-Umgebung gegen eine prozessinterne PostgreSQL-Instanz (PGlite) mit denselben Drizzle-Migrationen, sodass `bun run test:run` und CI ohne Docker oder Podman auskommen. Der Betrieb gegen den Container wird über die Compose-Datei und die Migrationsbefehle abgedeckt.

Das Backup-Ziel aus ADR 0001 bleibt bestehen, wechselt aber das Werkzeug: stündliche konsistente Sicherungen per `pg_dump` auf einen separaten Datenträger, sieben Tage Aufbewahrung und ein getesteter Wiederherstellungsweg; ein Datenverlust von bis zu einer Stunde wird akzeptiert. Dieser Teil bleibt der letzte Umsetzungsschritt.
