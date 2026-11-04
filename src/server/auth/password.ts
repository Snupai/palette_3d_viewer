import { hash, verify, type Algorithm, type Options } from "@node-rs/argon2";

/**
 * Argon2id parameters (OWASP 2024 baseline: m=19 MiB, t=2, p=1). Stored inside
 * the PHC string, so raising them later keeps existing hashes verifiable;
 * `passwordNeedsRehash` tells the login path when to upgrade a stored hash.
 */
export const ARGON2ID_PARAMS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** `Algorithm.Argon2id`; the package exports an ambient const enum, which `isolatedModules` cannot read. */
const ARGON2ID = 2 as Algorithm;

const HASH_OPTIONS: Options = { algorithm: ARGON2ID, ...ARGON2ID_PARAMS };

/** Upper bound so a login request cannot make the server hash megabytes. */
export const MAX_PASSWORD_LENGTH = 1024;
export const MIN_PASSWORD_LENGTH = 12;

export class PasswordPolicyError extends Error {}

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `password must be at most ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Hashes a new password as an argon2id PHC string after enforcing the policy. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return hash(password, HASH_OPTIONS);
}

/**
 * Verifies a password against a stored hash. Only argon2id hashes are
 * accepted; malformed hashes and over-long inputs verify as `false` instead
 * of throwing, so callers have one failure path.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  if (!storedHash.startsWith("$argon2id$")) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than the current ones. */
export function passwordNeedsRehash(storedHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
  if (!match) return true;
  const [, m, t, p] = match.map(Number);
  return (
    m! < ARGON2ID_PARAMS.memoryCost ||
    t! < ARGON2ID_PARAMS.timeCost ||
    p! !== ARGON2ID_PARAMS.parallelism
  );
}
