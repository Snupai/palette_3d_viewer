"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createTranslator, formatNumber, type MessageParams } from "./format";
import {
  FALLBACK_LOCALE,
  LOCALE_STORAGE_KEY,
  LOCALE_TAGS,
  isLocale,
  resolveLocale,
  type Locale,
} from "./locales";
import { MESSAGES, de, type MessageKey } from "./messages";

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export interface LocaleContextValue {
  locale: Locale;
  /** BCP-47 tag for `Intl` and `toLocale*` calls. */
  tag: string;
  /** `null` while the user has not chosen explicitly (system language in use). */
  preference: Locale | null;
  setLocale: (locale: Locale | null) => void;
  t: Translate;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

function buildValue(
  locale: Locale,
  preference: Locale | null,
  setLocale: (locale: Locale | null) => void,
): LocaleContextValue {
  return {
    locale,
    tag: LOCALE_TAGS[locale],
    preference,
    setLocale,
    t: createTranslator(MESSAGES[locale], de),
    formatNumber: (value, options) => formatNumber(locale, value, options),
  };
}

/**
 * Default used when no provider is mounted (unit tests, isolated renders):
 * German, not switchable. The app mounts `LocaleProvider` in the root layout.
 */
const DEFAULT_VALUE = buildValue(FALLBACK_LOCALE, null, () => undefined);

const LocaleContext = createContext<LocaleContextValue>(DEFAULT_VALUE);

function readStoredPreference(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : [];
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Server render and first client paint use the fallback so markup matches;
  // the effect switches to the stored/system language right after hydration.
  const [preference, setPreference] = useState<Locale | null>(null);
  const [locale, setLocaleState] = useState<Locale>(FALLBACK_LOCALE);

  useEffect(() => {
    const stored = readStoredPreference();
    setPreference(stored);
    setLocaleState(resolveLocale(stored, systemLanguages()));
  }, []);

  useEffect(() => {
    if (preference !== null) return;
    const onLanguageChange = () =>
      setLocaleState(resolveLocale(null, systemLanguages()));
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, [preference]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale | null) => {
    setPreference(next);
    setLocaleState(resolveLocale(next, systemLanguages()));
    try {
      if (next === null) window.localStorage.removeItem(LOCALE_STORAGE_KEY);
      else window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice still applies for this session.
    }
  }, []);

  const value = useMemo(
    () => buildValue(locale, preference, setLocale),
    [locale, preference, setLocale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Shorthand for components that only need to translate. */
export function useT(): Translate {
  return useContext(LocaleContext).t;
}
