import { randomUUID } from "node:crypto";

import { and, count, eq, gt, lte } from "drizzle-orm";

import type { PlannerDatabase } from "../db/database";
import { sessions, users, type UserRow } from "../db/schema";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "./password";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  isWellFormedSessionToken,
  sessionExpiresAt,
  SESSION_TTL_MS,
} from "./sessionToken";
import { normalizeUsername, type UserRole } from "./userModel";

/**
 * Local accounts and sessions (ADR 0005 / 0008). Server-only.
 *
 * Every function that depends on the clock takes `now`, so expiry is
 * deterministic in tests; callers pass `new Date()`.
 */

/** A user without the password hash — the only shape that leaves this module. */
export type AuthUser = Omit<UserRow, "passwordHash">;

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`username "${username}" is already taken`);
  }
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.createdAt,
  };
}

/**
 * Hash used to verify when the username does not exist, so a failed login
 * costs the same argon2 time either way and does not reveal valid usernames.
 */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  return dummyHash;
}

export async function createUser(
  db: PlannerDatabase,
  input: { username: string; password: string; role: UserRole },
  now: Date,
): Promise<AuthUser> {
  const username = normalizeUsername(input.username);
  const passwordHash = await hashPassword(input.password);
  const row: UserRow = {
    id: randomUUID(),
    username,
    passwordHash,
    role: input.role,
    createdAt: now,
  };
  // ON CONFLICT instead of a pre-check: two concurrent creates of the same
  // name cannot both pass, and the loser gets the domain error.
  const inserted = await db
    .insert(users)
    .values(row)
    .onConflictDoNothing({ target: users.username })
    .returning({ id: users.id });
  if (inserted.length === 0) throw new UsernameTakenError(username);
  return toAuthUser(row);
}

/**
 * Checks username + password. Returns the user on success, `null` for an
 * unknown user or wrong password (indistinguishable to the caller), and also
 * when the password was changed while this login was being checked. Stored
 * hashes made with weaker parameters are upgraded transparently.
 */
export async function authenticate(
  db: PlannerDatabase,
  rawUsername: string,
  password: string,
): Promise<AuthUser | null> {
  const verified = await verifyCredentials(db, rawUsername, password);
  if (!verified) return null;
  if (!(await passwordHashUnchanged(db, verified.row.id, verified.hash))) {
    return null;
  }
  return toAuthUser(verified.row);
}

/**
 * `authenticate` + `createSession` for the login route. The final "hash still
 * the one we verified" check and the session insert run in one transaction
 * holding the user row lock, so a concurrent `setUserPassword` either lands
 * first (login fails) or after (its session delete also removes this one).
 * `previousToken`, if given, is revoked in the same transaction.
 */
export async function loginWithPassword(
  db: PlannerDatabase,
  rawUsername: string,
  password: string,
  now: Date,
  previousToken?: string | null,
  ttlMs: number = SESSION_TTL_MS,
): Promise<{ user: AuthUser; session: CreatedSession } | null> {
  const verified = await verifyCredentials(db, rawUsername, password);
  if (!verified) return null;
  const token = generateSessionToken();
  const expiresAt = new Date(sessionExpiresAt(now.getTime(), ttlMs));
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, verified.row.id))
      .for("update");
    if (current?.passwordHash !== verified.hash) return null;
    if (previousToken && isWellFormedSessionToken(previousToken)) {
      await tx
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashSessionToken(previousToken)));
    }
    await tx.insert(sessions).values({
      tokenHash: hashSessionToken(token),
      userId: verified.row.id,
      expiresAt,
      createdAt: now,
    });
    return {
      user: toAuthUser(verified.row),
      session: { token, expiresAt },
    };
  });
}

/**
 * Checks username + password and transparently upgrades weak hashes.
 * Returns the row plus the hash now stored for it (the verified or the
 * upgraded one); callers must confirm that hash is still current before
 * trusting the result, because awaits here let a concurrent reset land.
 */
async function verifyCredentials(
  db: PlannerDatabase,
  rawUsername: string,
  password: string,
): Promise<{ row: UserRow; hash: string } | null> {
  let username: string;
  try {
    username = normalizeUsername(rawUsername);
  } catch {
    await verifyPassword(await getDummyHash(), password);
    return null;
  }
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!row) {
    await verifyPassword(await getDummyHash(), password);
    return null;
  }
  if (!(await verifyPassword(row.passwordHash, password))) return null;

  // The rehash write is conditional on the hash still being the one we
  // verified against; otherwise the reset wins (ADR 0005).
  const upgraded = passwordNeedsRehash(row.passwordHash)
    ? await hashPassword(password).catch(() => null)
    : null;
  if (!upgraded) return { row, hash: row.passwordHash };
  const swapped = await db
    .update(users)
    .set({ passwordHash: upgraded })
    .where(and(eq(users.id, row.id), eq(users.passwordHash, row.passwordHash)))
    .returning({ id: users.id });
  return swapped.length === 0 ? null : { row, hash: upgraded };
}

async function passwordHashUnchanged(
  db: PlannerDatabase,
  userId: string,
  verifiedHash: string,
): Promise<boolean> {
  const [current] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return current?.passwordHash === verifiedHash;
}

/**
 * Sets a new password and revokes all of the user's sessions in one
 * transaction (ADR 0005: a reset invalidates existing logins). Returns
 * `false` for an unknown user.
 */
export async function setUserPassword(
  db: PlannerDatabase,
  userId: string,
  password: string,
): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) return false;
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    return true;
  });
}

export type CreatedSession = {
  /** Plain token for the cookie. Never stored; only returned once. */
  token: string;
  expiresAt: Date;
};

export async function createSession(
  db: PlannerDatabase,
  userId: string,
  now: Date,
  ttlMs: number = SESSION_TTL_MS,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(sessionExpiresAt(now.getTime(), ttlMs));
  await db.insert(sessions).values({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
    createdAt: now,
  });
  return { token, expiresAt };
}

export type VerifiedSession = {
  user: AuthUser;
  expiresAt: Date;
};

/**
 * Resolves a cookie token to its user. Returns `null` for malformed, unknown,
 * revoked or expired tokens; an expired session row is deleted on sight.
 */
export async function verifySession(
  db: PlannerDatabase,
  token: string,
  now: Date,
): Promise<VerifiedSession | null> {
  if (!isWellFormedSessionToken(token)) return null;
  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (isSessionExpired(row.session.expiresAt.getTime(), now.getTime())) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }
  return { user: toAuthUser(row.user), expiresAt: row.session.expiresAt };
}

/** Logs out one session. Returns whether a session was removed. */
export async function revokeSession(
  db: PlannerDatabase,
  token: string,
): Promise<boolean> {
  if (!isWellFormedSessionToken(token)) return false;
  const removed = await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .returning({ tokenHash: sessions.tokenHash });
  return removed.length > 0;
}

/** Logs a user out everywhere. Returns the number of sessions removed. */
export async function revokeAllSessionsForUser(
  db: PlannerDatabase,
  userId: string,
): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ tokenHash: sessions.tokenHash });
  return removed.length;
}

/** Housekeeping: drops sessions that expired at or before `now`. */
export async function deleteExpiredSessions(
  db: PlannerDatabase,
  now: Date,
): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ tokenHash: sessions.tokenHash });
  return removed.length;
}

/** Number of live sessions for a user (admin overview). */
export async function countActiveSessions(
  db: PlannerDatabase,
  userId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)));
  return row?.value ?? 0;
}
