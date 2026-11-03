export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

export class UsernameError extends Error {}

/**
 * Usernames are case-insensitive: they are trimmed and lower-cased before
 * storage and lookup, so `Admin` and `admin` are the same account.
 */
export function normalizeUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new UsernameError(
      "username must be 3–64 characters of a–z, 0–9, '.', '_' or '-', starting and ending alphanumerically",
    );
  }
  return username;
}

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
