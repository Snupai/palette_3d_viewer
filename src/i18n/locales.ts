/**
 * Supported UI languages. Add a new entry here, a `messages/<locale>` folder and
 * the merge in `messages/index.ts` to ship another language.
 */
export const SUPPORTED_LOCALES = ["de", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Used when neither a stored preference nor the system language matches. */
export const FALLBACK_LOCALE: Locale = "de";

export const LOCALE_STORAGE_KEY = "palettenplaner.locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
};

/** BCP-47 tag used for `Intl` formatting and `<html lang>`. */
export const LOCALE_TAGS: Record<Locale, string> = {
  de: "de-DE",
  en: "en-GB",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/** Maps a BCP-47 tag such as `de-AT` or `en_US` onto a supported locale. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

/**
 * Resolution order: explicit stored choice → first matching system language →
 * fallback. Pure so it can be tested without a browser.
 */
export function resolveLocale(
  stored: string | null | undefined,
  systemLanguages: readonly string[],
): Locale {
  if (isLocale(stored)) return stored;
  for (const language of systemLanguages) {
    const match = matchLocale(language);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}
