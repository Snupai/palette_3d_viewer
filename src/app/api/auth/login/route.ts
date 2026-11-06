import { createLoginHandler } from "~/server/auth/loginHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createLoginHandler();
