import type { Locale } from "./locales";

export type MessageParams = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Fills `{name}` placeholders. Unknown placeholders are left intact so a missing
 * parameter is visible in the UI instead of silently rendering "undefined".
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Picks `<key>_one` / `<key>_other` when `params.count` is a number and those
 * variants exist, otherwise falls back to `<key>` itself.
 */
export function selectPluralKey(
  key: string,
  params: MessageParams | undefined,
  has: (candidate: string) => boolean,
): string {
  const count = params?.count;
  if (typeof count !== "number") return key;
  const variant = count === 1 ? `${key}_one` : `${key}_other`;
  return has(variant) ? variant : key;
}

export function createTranslator<Key extends string>(
  messages: Record<Key, string>,
  fallback: Record<Key, string>,
): (key: Key, params?: MessageParams) => string {
  const has = (candidate: string): boolean =>
    candidate in messages || candidate in fallback;
  return (key, params) => {
    const resolved = selectPluralKey(key, params, has) as Key;
    const template = messages[resolved] ?? fallback[resolved] ?? resolved;
    return interpolate(template, params);
  };
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(
    locale === "de" ? "de-DE" : "en-GB",
    options,
  ).format(value);
}
