# SQLite auf einem einzelnen Server

> **Ersetzt** durch [ADR 0009](0009-postgres-container.md): PostgreSQL im Container (Docker/Podman) statt SQLite-Datei.

Die erste servergestützte Version läuft auf einem einzelnen Host mit dauerhaftem lokalem Datenträger und einer SQLite-Datenbank im WAL-Modus; `PALETTE_DB_PATH` legt den Pfad der Datenbank fest. Das entspricht dem Betrieb im Werksnetz und vermeidet die zusätzlichen Betriebsanforderungen einer verteilten Datenbank. Mehrere verteilte Schreibinstanzen sind nicht vorgesehen.

Stündliche konsistente SQLite-Backups auf einen separaten Datenträger mit sieben Tagen Aufbewahrung und einem Wiederherstellungstest sind als Ziel bestätigt; damit wird ein möglicher Datenverlust von bis zu einer Stunde akzeptiert. Auf ausdrücklichen Wunsch wird dieser Teil erst als letzter Umsetzungsschritt bearbeitet. Die Backup-Funktion ist derzeit nicht implementiert.
