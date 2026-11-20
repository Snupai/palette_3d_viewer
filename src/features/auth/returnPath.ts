/**
 * Where the sign-in page (`/login?returnTo=…`) may send the user afterwards.
 * Only same-origin paths are allowed, so the parameter cannot be used as an
 * open redirect: anything else falls back to the planner home.
 */

export const LOGIN_PATH = "/login";
export const RETURN_TO_PARAM = "returnTo";

const FALLBACK = "/";
const PROBE_ORIGIN = "https://return-path.invalid";
// C0/C1 controls, DEL, backslash and whitespace: browsers strip or reinterpret
// some of them (`/\evil.com`, `/\t/evil.com`), so refuse them outright.
const UNSAFE = /[\u0000- \u007f-\u009f\\]/;

/**
 * `value` as a same-origin path (path, query and fragment), or `/`. Rejects
 * absolute and protocol-relative URLs, backslashes, control characters, and
 * the sign-in page itself (no loop).
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length > 2048) return FALLBACK;
  if (!value.startsWith("/") || value.startsWith("//")) return FALLBACK;
  if (UNSAFE.test(value)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== PROBE_ORIGIN) return FALLBACK;
  if (
    url.pathname === LOGIN_PATH ||
    url.pathname.startsWith(`${LOGIN_PATH}/`)
  ) {
    return FALLBACK;
  }
  // Dot segments can normalize to `//host` (`/a/..//evil.example`).
  if (url.pathname.startsWith("//")) return FALLBACK;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The sign-in page that returns to `path` afterwards. */
export function loginHref(path: string): string {
  const target = safeReturnPath(path);
  return target === FALLBACK
    ? LOGIN_PATH
    : `${LOGIN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(target)}`;
}
