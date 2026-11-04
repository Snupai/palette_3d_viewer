# syntax=docker/dockerfile:1
# Production image for the planner (issue #49, ADR 0009). Works with Docker and
# Podman/Buildah: base images are fully qualified. Targets:
#   runner  — Next.js standalone server (default, last stage)
#   migrate — one-shot `drizzle/` migration runner for compose
#
#   docker build -t palette-app .
#   docker build --build-arg NEXT_PUBLIC_PALETTE_STORAGE_MODE=server .

ARG BUN_IMAGE=docker.io/oven/bun:1.3.14
ARG NODE_IMAGE=docker.io/library/node:22-bookworm-slim

FROM ${BUN_IMAGE} AS bun

# --- toolchain: Node (Next.js build, `postinstall`) + the pinned Bun binary
FROM ${NODE_IMAGE} AS toolchain
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# --- deps: install once; postinstall copies the onnxruntime wasm into public/ort
FROM toolchain AS deps
COPY package.json bun.lock ./
COPY scripts/copy-ort-wasm.mjs ./scripts/
RUN bun install --frozen-lockfile

# --- build: Next.js standalone output + bundled migration script
FROM toolchain AS build
# Inlined into the client bundle at build time. Stays `local` (IndexedDB) until
# the server storage client (#33) exists; `server` would make every storage
# call throw today. Flip it later with
#   PALETTE_STORAGE_MODE=server docker compose up -d --build
ARG NEXT_PUBLIC_PALETTE_STORAGE_MODE=local
ARG NEXT_PUBLIC_DISABLE_AI_FEATURES
ENV NEXT_PUBLIC_PALETTE_STORAGE_MODE=${NEXT_PUBLIC_PALETTE_STORAGE_MODE} \
    NEXT_PUBLIC_DISABLE_AI_FEATURES=${NEXT_PUBLIC_DISABLE_AI_FEATURES} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/public/ort ./public/ort
RUN bun run build \
 && bun build scripts/db-migrate.ts --target=node --format=esm \
      --outfile=dist/db-migrate.mjs

# --- shared slim Node runtime, non-root
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# --- migrate: applies drizzle/ to DATABASE_URL, then exits
FROM base AS migrate
COPY --from=build --chown=node:node /app/dist/db-migrate.mjs ./db-migrate.mjs
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
CMD ["node", "db-migrate.mjs"]

# --- runner: Next.js standalone server
FROM base AS runner
ENV PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
