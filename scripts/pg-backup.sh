#!/bin/sh
# PostgreSQL backups for the planner (ADR 0009, issue #38). Runs inside the
# compose `backup` service (docker.io/library/postgres:17, so pg_dump matches
# the server's major version) and is plain POSIX sh for Docker and Podman.
#
#   pg-backup.sh loop              dump now, then every PALETTE_BACKUP_INTERVAL_SECONDS
#   pg-backup.sh once              one dump + prune (`bun run db:backup`)
#   pg-backup.sh health            exit 0 if the newest dump is fresh (healthcheck)
#   pg-backup.sh restore FILE --yes
#                                  replace the database contents with FILE
#
# A dump is `pg_dump -Fc`: one transaction (consistent MVCC snapshot) while
# the app keeps running. It is written to a hidden partial file, checked with
# `pg_restore --list` and only then renamed, so a finished `palette-*.dump`
# is always complete. Dumps older than PALETTE_BACKUP_RETENTION_DAYS are
# deleted — only after a successful dump, so a broken database connection
# never erases the last good backups.
set -eu

BACKUP_DIR=${PALETTE_BACKUP_DIR:-/backups}
INTERVAL_SECONDS=${PALETTE_BACKUP_INTERVAL_SECONDS:-3600}
RETENTION_DAYS=${PALETTE_BACKUP_RETENTION_DAYS:-7}
PG_DUMP=${PG_DUMP:-pg_dump}
PG_RESTORE=${PG_RESTORE:-pg_restore}
PSQL=${PSQL:-psql}
DROP_ALL_SCHEMAS="DO \$\$ DECLARE s name; BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
  LOOP EXECUTE format('DROP SCHEMA %I CASCADE', s); END LOOP;
END \$\$; CREATE SCHEMA public;"
# Connection: libpq reads PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.

log() {
  printf '%s pg-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

is_positive_int() {
  case $1 in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  return 0
}

check_config() {
  is_positive_int "$INTERVAL_SECONDS" || {
    log "PALETTE_BACKUP_INTERVAL_SECONDS must be a positive integer, got '$INTERVAL_SECONDS'"
    exit 2
  }
  is_positive_int "$RETENTION_DAYS" || {
    log "PALETTE_BACKUP_RETENTION_DAYS must be a positive integer, got '$RETENTION_DAYS'"
    exit 2
  }
  [ -d "$BACKUP_DIR" ] || {
    log "backup directory $BACKUP_DIR does not exist (is PALETTE_BACKUP_DIR mounted?)"
    exit 2
  }
}

prune() {
  # -mmin +N: modified more than N minutes ago. Only our own file names.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'palette-*.dump' \
    -mmin +"$((RETENTION_DAYS * 24 * 60))" -print | while IFS= read -r old; do
    rm -f -- "$old" && log "pruned $(basename "$old")"
  done
  # Leftovers of a dump that was killed mid-write.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '.palette-*.partial' -mmin +1440 -exec rm -f -- {} +
}

backup_once() {
  name="palette-$(date -u +%Y%m%dT%H%M%SZ).dump"
  partial="$BACKUP_DIR/.$name.partial"
  # Dumps contain password hashes: readable by the owner only.
  if (umask 077 && "$PG_DUMP" --format=custom --file="$partial") &&
    "$PG_RESTORE" --list "$partial" >/dev/null; then
    mv -f -- "$partial" "$BACKUP_DIR/$name"
    log "wrote $name ($(wc -c <"$BACKUP_DIR/$name" | tr -d ' ') bytes)"
    prune
    return 0
  fi
  rm -f -- "$partial"
  log "backup FAILED; existing dumps kept"
  return 1
}

health() {
  # Fresh = newer than two intervals plus slack for a slow dump.
  max_minutes=$(((2 * INTERVAL_SECONDS + 300 + 59) / 60))
  newest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'palette-*.dump' -mmin -"$max_minutes" -print | head -n 1)
  [ -n "$newest" ] || {
    echo "no dump newer than $max_minutes minutes in $BACKUP_DIR"
    exit 1
  }
}

restore() {
  file=${1:-}
  confirm=${2:-}
  if [ -z "$file" ]; then
    log "usage: pg-backup.sh restore palette-YYYYMMDDTHHMMSSZ.dump --yes"
    exit 2
  fi
  case $file in
    /*) path=$file ;;
    *) path="$BACKUP_DIR/$file" ;;
  esac
  [ -f "$path" ] || {
    log "no such backup: $path"
    exit 2
  }
  "$PG_RESTORE" --list "$path" >/dev/null || {
    log "$path is not a readable pg_dump archive"
    exit 2
  }
  if [ "$confirm" != "--yes" ]; then
    log "restore REPLACES all data in database ${PGDATABASE:-palette} with $(basename "$path")."
    log "Stop the app first, then re-run with --yes."
    exit 2
  fi
  log "restoring $(basename "$path") into ${PGDATABASE:-palette}"
  # The dump as SQL first, so a broken archive stops before anything changes.
  sql=$(mktemp)
  trap 'rm -f -- "$sql"' EXIT
  "$PG_RESTORE" --no-owner --file="$sql" "$path"
  # One transaction: drop every non-system schema (also tables a newer
  # migration added after the dump was taken), recreate `public`, replay the
  # dump. On any error nothing is changed.
  PGOPTIONS="-c client_min_messages=warning" "$PSQL" -X -q -o /dev/null \
    -v ON_ERROR_STOP=1 --single-transaction \
    --dbname="${PGDATABASE:-palette}" -c "$DROP_ALL_SCHEMAS" -f "$sql"
  log "restore finished"
}

command=${1:-loop}
[ $# -gt 0 ] && shift
case $command in
  loop)
    check_config
    trap 'log "stopping"; exit 0' TERM INT
    log "every ${INTERVAL_SECONDS}s into $BACKUP_DIR, keeping ${RETENTION_DAYS} days"
    while :; do
      backup_once || true
      sleep "$INTERVAL_SECONDS" &
      wait $! || true
    done
    ;;
  once)
    check_config
    backup_once
    ;;
  health)
    check_config
    health
    ;;
  restore)
    restore "$@"
    ;;
  *)
    log "unknown command '$command' (loop | once | health | restore FILE --yes)"
    exit 2
    ;;
esac
