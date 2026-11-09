# Container operations for Linux/macOS; no Bun installation required.
# Defaults to Podman. Use CONTAINER_ENGINE=docker just up for Docker.
set dotenv-load
set positional-arguments

# Show available commands.
default:
    @just --list

# Build and start the full stack, including migrations and backups.
up:
    mkdir -p "${PALETTE_BACKUP_DIR:-backups}"
    "${CONTAINER_ENGINE:-podman}" compose up -d --build

# Stop the stack; keep the database volume.
down:
    "${CONTAINER_ENGINE:-podman}" compose down

# Show all containers, including the completed migration.
status:
    "${CONTAINER_ENGINE:-podman}" compose ps -a

# Follow logs (optionally name services, e.g. just logs app).
logs *services:
    "${CONTAINER_ENGINE:-podman}" compose logs -f "$@"

# Start only PostgreSQL.
db-up:
    "${CONTAINER_ENGINE:-podman}" compose up -d db

# Write an additional database backup.
backup:
    mkdir -p "${PALETTE_BACKUP_DIR:-backups}"
    "${CONTAINER_ENGINE:-podman}" compose run --rm backup once

# Restore a dump; stop app/backup first. Explicit --yes is required by the script.
restore file +flags:
    "${CONTAINER_ENGINE:-podman}" compose run --rm backup restore "$@"

# Create the first admin (interactive password prompt).
admin-init:
    "${CONTAINER_ENGINE:-podman}" compose run --rm migrate node admin.mjs init

# Reset an admin password (interactive password prompt).
admin-reset-password username:
    "${CONTAINER_ENGINE:-podman}" compose run --rm migrate node admin.mjs reset-password --username "$1"
