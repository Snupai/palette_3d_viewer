/**
 * Local admin commands (ADR 0005, issue #29):
 *
 *   bun run admin:init [--username <name>]            # first admin; idempotent
 *   bun run admin:reset-password [--username <name>]  # new password, revokes sessions
 *
 * Connects to `DATABASE_URL` (Bun also reads `.env`); run `bun run db:migrate`
 * first. Passwords are read without echo from the terminal, or one per line
 * from piped stdin. All logic is in `src/server/auth/adminCli.ts`.
 */

import { createHiddenPrompt } from "./hiddenPrompt";

// `src/env.js` requires NODE_ENV, which a plain CLI run does not set. Default
// it before the (dynamic) import so static import hoisting cannot reorder it.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "production";

const { env } = await import("~/env");
const { openDatabase } = await import("~/server/db/database");
const { AdminCliError, initAdmin, resetAdminPassword } = await import(
  "~/server/auth/adminCli"
);

const USAGE = "usage: admin.ts <init|reset-password> [--username <name>]";

function parseArgs(argv: readonly string[]): {
  command: "init" | "reset-password";
  username?: string;
} {
  const [command, ...rest] = argv;
  if (command !== "init" && command !== "reset-password") {
    throw new AdminCliError(USAGE);
  }
  let username: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === "--username" && rest[i + 1] !== undefined) {
      username = rest[(i += 1)];
    } else if (arg.startsWith("--username=")) {
      username = arg.slice("--username=".length);
    } else {
      throw new AdminCliError(USAGE);
    }
  }
  return { command, username };
}

const report = (message: string) => console.error(`  ${message}`);

/**
 * Domain errors print as-is; driver errors (wrapped by Drizzle's "Failed
 * query") print their root cause plus the usual fix.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!error.cause) return error.message;
  let root: unknown = error;
  while (root instanceof Error && root.cause) root = root.cause;
  const detail =
    root instanceof Error
      ? root.message || ((root as { code?: string }).code ?? root.name)
      : String(root);
  return `database error: ${detail}
  Is PostgreSQL running at DATABASE_URL and migrated? (bun run db:up && bun run db:migrate)`;
}

function parseArgsOrExit(): ReturnType<typeof parseArgs> {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
}
const args = parseArgsOrExit();
let exitCode = 0;

const url = env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const database = openDatabase(url, { maxConnections: 1 });
const hidden = createHiddenPrompt();
try {
  const io = { prompt: hidden.prompt, report };
  if (args.command === "init") {
    const result = await initAdmin(
      database.db,
      { username: args.username, now: new Date() },
      io,
    );
    console.log(
      result.status === "created"
        ? `Created admin "${result.user.username}".`
        : `Admin "${result.user.username}" already exists; nothing changed. Use admin:reset-password to set a new password.`,
    );
  } else {
    const admin = await resetAdminPassword(
      database.db,
      { username: args.username },
      io,
    );
    console.log(
      `Password of admin "${admin.username}" changed; all of its sessions were revoked.`,
    );
  }
} catch (error) {
  console.error(describeError(error));
  exitCode = 1;
} finally {
  hidden.close();
  await database.close();
}
process.exit(exitCode);
