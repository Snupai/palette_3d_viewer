"use client";

import { useLocale } from "./LocaleProvider";
import { LOCALE_LABELS, SUPPORTED_LOCALES, isLocale } from "./locales";

/** Compact `<select>` for the header; the choice persists in localStorage. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <select
      className={className ?? "language-switcher"}
      aria-label={t("shell.language")}
      value={locale}
      onChange={(event) => {
        const next = event.target.value;
        if (isLocale(next)) setLocale(next);
      }}
    >
      {SUPPORTED_LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
