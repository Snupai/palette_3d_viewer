# Deployment mit Docker oder Podman

Die vorhandene `compose.yaml` startet PostgreSQL 17, die Datenbankmigration,
die Website und stündliche Backups. Die folgenden Befehle werden im
Repository-Verzeichnis ausgeführt. Bun muss auf dem Host dafür nicht installiert
sein; der Image-Build installiert die Abhängigkeiten selbst.

## Voraussetzungen

- Docker mit Compose oder Podman mit einem installierten Compose-Provider.
  Prüfen mit `docker compose version` beziehungsweise `podman compose version`.
- Unter Windows/macOS muss die Container-VM laufen (Docker Desktop oder Podman
  Desktop). Eine neue Podman-VM bei Bedarf mit `podman machine init` anlegen und
  mit `podman machine start` starten.
- Freie lokale Ports 3000 und 5432 sowie Speicher für Images, Datenbank und Backups.

## Konfiguration

Im Repository eine `.env` anlegen beziehungsweise eine vorhandene ergänzen:

```dotenv
PALETTE_STORAGE_MODE=server
PALETTE_DB_PASSWORD=HIER_EIN_LANGES_ZUFAELLIGES_PASSWORT_EINTRAGEN
PALETTE_APP_PORT=3000
PALETTE_DB_PORT=5432
PALETTE_BACKUP_DIR=./backups
```

Das Passwort vor dem ersten Start ersetzen. Zulässige Zeichen sind
`A-Z a-z 0-9 - . _ ~`, weil Compose es direkt in die Datenbank-URL einsetzt.
Die `.env` bleibt lokal und wird nicht eingecheckt. `DATABASE_URL` wird für die
Container automatisch gesetzt.

`PALETTE_STORAGE_MODE=server` muss auch bei späteren Builds gesetzt bleiben:
Ohne diese Einstellung speichert die Website standardmäßig im Browser.
Die Compose-Variable heißt anders als die Einstellung für einen direkten
Next.js-Start (`NEXT_PUBLIC_PALETTE_STORAGE_MODE`).

Das Backup-Verzeichnis vor dem Start anlegen. PowerShell:

```powershell
New-Item -ItemType Directory -Force backups
```

Linux/macOS: `mkdir -p backups`. Bei einem anderen `PALETTE_BACKUP_DIR` stattdessen
dieses Verzeichnis anlegen; für den dauerhaften Betrieb eine separate Platte
verwenden. Unter Docker/Linux gegebenenfalls `PALETTE_BACKUP_USER=1000:1000`
auf den Eigentümer des Verzeichnisses abstimmen.

## Docker starten

```sh
docker compose up -d --build
docker compose ps -a
docker compose logs migrate
docker compose run --rm migrate node admin.mjs init
```

## Podman starten

```sh
podman compose up -d --build
podman compose ps -a
podman compose logs migrate
podman compose run --rm migrate node admin.mjs init
```

Beide Varianten bauen dieselben Images. `migrate` muss erfolgreich mit Exitcode 0
enden; anschließend startet `app`. `db`, `app` und nach dem ersten Backup auch
`backup` sollten gesund sein. Der Admin-Befehl fragt das Passwort verdeckt ab.
Danach die Website unter <http://localhost:3000> öffnen und anmelden.

## Änderungen ausrollen und stoppen

Nach Änderungen am Code oder den Build-Einstellungen:

```sh
docker compose up -d --build
```

Für Podman jeweils `docker` durch `podman` ersetzen. Auch
`PALETTE_DISABLE_AI_FEATURES` ist eine Build-Einstellung. Nach Änderungen an
Runtime-Einstellungen wie `SHEET_EXTRACTION_URL` genügt `docker compose up -d`.
Ein bloßes `restart` übernimmt weder neuen Code noch geänderte Umgebungsvariablen.

`docker compose down` stoppt den Stack und erhält das Datenbankvolume.
**Kein `down -v` ausführen**, wenn die Daten erhalten bleiben sollen.
Ein neues `PALETTE_DB_PASSWORD` in `.env` ändert das Passwort einer bereits
initialisierten PostgreSQL-Datenbank nicht; eine Passwortrotation muss auch in
PostgreSQL vorgenommen werden.

## Backups und Wiederherstellung

```sh
docker compose run --rm backup once
docker compose logs backup
```

Wiederherstellung ersetzt die gesamte Datenbank. Vorher den Stack auf denselben
Code-Stand wie das Backup bringen und die schreibenden Dienste stoppen:

```sh
docker compose stop app backup
docker compose run --rm backup restore palette-20261105T140000Z.dump --yes
docker compose up -d
```

Den Beispieldateinamen durch eine vorhandene Datei im Backup-Verzeichnis ersetzen.
Details zu Aufbewahrung und Wiederherstellung stehen im
[README](../README.md#backups-and-restore).

## Zugriff im Werksnetz

Compose bindet Website und Datenbank ausschließlich an `127.0.0.1`.
Für andere Rechner einen HTTPS-Reverse-Proxy auf dem Host vor die Website
schalten, mit einem auf den Clients vertrauenswürdigen Zertifikat und Weiterleitung
an `http://127.0.0.1:3000`. Die Datenbank bleibt lokal gebunden.
Angemeldeter Betrieb benötigt HTTPS gemäß [ADR 0008](adr/0008-https-authentication.md);
die HTTP-Ausnahme gilt nur für lokale Entwicklung über `localhost`.

## Optional: lokaler Bildimport mit llama.cpp

In `.env` ergänzen:

```dotenv
SHEET_EXTRACTION_API=openai
SHEET_EXTRACTION_URL=http://host.docker.internal:8080
SHEET_EXTRACTION_API_KEY=DEIN_MODELLSERVER_KEY
```

Unter Podman stattdessen `http://host.containers.internal:8080` verwenden.
Der Modellserver muss aus dem Container erreichbar sein; `localhost` im Container
bezeichnet den Container selbst. llama.cpp benötigt ein Vision-Modell mit
passendem `--mmproj`; bei Router-Betrieb zusätzlich `SHEET_EXTRACTION_MODEL`
setzen. Anschließend `compose up -d` mit der gewählten Engine ausführen.

## Fehler eingrenzen

- `compose logs app migrate db` zeigt Build-unabhängige Start- und Verbindungsfehler.
- Bei belegten Ports `PALETTE_APP_PORT` oder `PALETTE_DB_PORT` ändern und `up -d`
  erneut ausführen.
- Bei fehlendem Podman-Compose-Provider diesen installieren und zuerst
  `podman compose version` erfolgreich ausführen.
- Bei fehlenden Backups Verzeichnis, Schreibrechte und `compose logs backup`
  prüfen. Das erste Backup kann etwas Zeit benötigen.
