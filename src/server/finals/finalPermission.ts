import type { SessionUser } from "../auth/sessionUser";

/**
 * Who may mark a project finished or withdraw a Fertigstand (ADR 0013).
 * The one place to change that rule: for now every signed-in user may.
 * The client mirrors it in `canManageFinals` (`projectFinalModel.ts`).
 */
export function mayManageFinals(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "user";
}
