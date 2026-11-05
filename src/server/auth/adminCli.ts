import { and, asc, eq } from "drizzle-orm";

import type { PlannerDatabase } from "../db/database";
import { users } from "../db/schema";
import {
  createUser,
  setUserPassword,
  UsernameTakenError,
  type AuthUser,
} from "./accounts";
import { describePasswordProblem, passwordProblem } from "./passwordStrength";
import { normalizeUsername } from "./userModel";

/**
 * Admin initialization and recovery (ADR 0005), driven by the local
 * `bun run admin:init` / `admin:reset-password` commands. The script in
 * `scripts/admin.ts` is only argv parsing and a hidden terminal prompt; all
 * decisions live here and take the database and the prompt as parameters.
 */

/** Asks for one secret without echoing it. `label` is the visible prompt. */
export type PasswordPrompt = (label: string) => Promise<string>;

export const DEFAULT_ADMIN_USERNAME = "admin";

/** Weak passwords and mismatched confirmations are retried this many times. */
export const MAX_PASSWORD_ATTEMPTS = 3;

export class AdminCliError extends Error {}

/**
 * Strength check from {@link passwordProblem} as English text for the
 * terminal. Returns the reason, or `null` if accepted.
 */
export function adminPasswordProblem(
  password: string,
  username: string,
): string | null {
  const problem = passwordProblem(password, username);
  return problem ? describePasswordProblem(problem) : null;
}

/**
 * Prompts for a new password and its confirmation until both match and pass
 * {@link adminPasswordProblem}, at most {@link MAX_PASSWORD_ATTEMPTS} times.
 * `report` receives the reason for each rejected attempt (never the password).
 */
export async function promptNewAdminPassword(
  prompt: PasswordPrompt,
  username: string,
  report: (message: string) => void,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt += 1) {
    const password = await prompt(`New password for "${username}": `);
    const problem = adminPasswordProblem(password, username);
    if (problem) {
      report(problem);
      continue;
    }
    if ((await prompt("Repeat password: ")) !== password) {
      report("passwords do not match");
      continue;
    }
    return password;
  }
  throw new AdminCliError(
    `no acceptable password after ${MAX_PASSWORD_ATTEMPTS} attempts; nothing changed`,
  );
}

async function findAdmin(
  db: PlannerDatabase,
  username?: string,
): Promise<AuthUser | undefined> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      username
        ? and(eq(users.role, "admin"), eq(users.username, username))
        : eq(users.role, "admin"),
    )
    .orderBy(asc(users.createdAt), asc(users.username))
    .limit(1);
  return row;
}

export type InitAdminResult =
  | { status: "created"; user: AuthUser }
  | { status: "exists"; user: AuthUser };

export interface AdminCommandIo {
  readonly prompt: PasswordPrompt;
  readonly report: (message: string) => void;
}

/**
 * `admin:init`: creates the first admin. Idempotent — if any admin already
 * exists it is returned unchanged and no password is asked for. A username
 * already taken by a non-admin account is an error, never a promotion.
 */
export async function initAdmin(
  db: PlannerDatabase,
  input: { username?: string; now: Date },
  io: AdminCommandIo,
): Promise<InitAdminResult> {
  const username = normalizeUsername(input.username ?? DEFAULT_ADMIN_USERNAME);
  const existing = await findAdmin(db);
  if (existing) return { status: "exists", user: existing };

  const password = await promptNewAdminPassword(io.prompt, username, io.report);
  try {
    const user = await createUser(
      db,
      { username, password, role: "admin" },
      input.now,
    );
    return { status: "created", user };
  } catch (error) {
    if (!(error instanceof UsernameTakenError)) throw error;
    // A concurrent init may have won the race; that is still "exists".
    const raced = await findAdmin(db, username);
    if (raced) return { status: "exists", user: raced };
    throw new AdminCliError(
      `username "${username}" belongs to a non-admin account; choose another with --username`,
    );
  }
}

/**
 * `admin:reset-password`: sets a new password for an admin and revokes all of
 * that admin's sessions (ADR 0005). Without a username the single oldest admin
 * is used. Unknown or non-admin usernames fail before any prompt.
 */
export async function resetAdminPassword(
  db: PlannerDatabase,
  input: { username?: string },
  io: AdminCommandIo,
): Promise<AuthUser> {
  const username =
    input.username === undefined
      ? undefined
      : normalizeUsername(input.username);
  const admin = await findAdmin(db, username);
  if (!admin) {
    throw new AdminCliError(
      username
        ? `no admin named "${username}"`
        : "no admin exists yet; run admin:init first",
    );
  }
  const password = await promptNewAdminPassword(
    io.prompt,
    admin.username,
    io.report,
  );
  if (!(await setUserPassword(db, admin.id, password))) {
    throw new AdminCliError(`admin "${admin.username}" was deleted meanwhile`);
  }
  return admin;
}
