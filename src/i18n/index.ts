export {
  LocaleProvider,
  useLocale,
  useT,
  type Translate,
} from "./LocaleProvider";
export { createTranslator, interpolate, type MessageParams } from "./format";
export { translateDe } from "./translateDe";
export {
  FALLBACK_LOCALE,
  LOCALE_LABELS,
  LOCALE_TAGS,
  SUPPORTED_LOCALES,
  isLocale,
  matchLocale,
  resolveLocale,
  type Locale,
} from "./locales";
export { MESSAGES, de, en, type MessageKey, type Messages } from "./messages";
