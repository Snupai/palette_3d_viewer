import type { Metadata } from "next";

import { LoginScreen } from "~/features/auth/LoginScreen";
import { RETURN_TO_PARAM } from "~/features/auth/returnPath";

export const metadata: Metadata = { title: "Anmelden" };

/**
 * `/login?returnTo=/path` — full-page sign-in; returns to `returnTo` when it
 * is a same-origin path (checked in `LoginScreen`), else to the planner.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const value = (await searchParams)[RETURN_TO_PARAM];
  return (
    <main className="fable-app">
      <LoginScreen returnTo={typeof value === "string" ? value : null} />
    </main>
  );
}
