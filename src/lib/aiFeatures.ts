import { env } from "~/env";

/**
 * False when the deployment opts out of AI (`NEXT_PUBLIC_DISABLE_AI_FEATURES`):
 * no sheet-photo upload in the UI and no model calls on the server.
 */
export const aiFeaturesEnabled = !["true", "1"].includes(
  env.NEXT_PUBLIC_DISABLE_AI_FEATURES ?? "",
);
