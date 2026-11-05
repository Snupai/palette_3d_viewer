import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password";

/**
 * Strength rules for passwords chosen by an admin — for themselves via the
 * CLI (#29) or for another user via the admin API (#32). Server-only.
 */

/** Smallest number of distinct characters a password must contain. */
export const MIN_DISTINCT_PASSWORD_CHARS = 5;

export type PasswordProblem =
  | "too_short"
  | "too_long"
  | "contains_username"
  | "too_few_distinct";

/**
 * Length policy plus: no password that contains the username, and enough
 * distinct characters that `aaaaaaaaaaaa` or `121212121212` are rejected.
 * Returns the first violated rule, or `null` if accepted.
 */
export function passwordProblem(
  password: string,
  username: string,
): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "too_long";
  if (password.toLowerCase().includes(username.toLowerCase())) {
    return "contains_username";
  }
  if (new Set(password).size < MIN_DISTINCT_PASSWORD_CHARS) {
    return "too_few_distinct";
  }
  return null;
}

/** English text for CLI output and logs. */
export function describePasswordProblem(problem: PasswordProblem): string {
  switch (problem) {
    case "too_short":
      return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    case "too_long":
      return `password must be at most ${MAX_PASSWORD_LENGTH} characters`;
    case "contains_username":
      return "password must not contain the username";
    case "too_few_distinct":
      return `password must contain at least ${MIN_DISTINCT_PASSWORD_CHARS} different characters`;
  }
}
