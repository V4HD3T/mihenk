/**
 * Translation, without a dependency.
 *
 * The whole need here is: look up a key, substitute a few values, remember the
 * choice, and fall back to English when a Turkish string is missing. A
 * library would add a bundle and an API surface for features this app doesn't
 * use (plural categories beyond one/other, namespaces, lazy loading, ICU).
 *
 * `t('courses.join')` returns the string; `t('exam.timeLeft', { time })`
 * substitutes `{time}`. A missing key returns the key itself, which is ugly on
 * screen and therefore hard to miss - preferable to silently rendering nothing.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import en from './en.json';
import tr from './tr.json';

const CATALOGUES = { en, tr };
export const LANGUAGES = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'English' },
];

const STORAGE_KEY = 'mihenk_language';

/** Remembered choice, else the browser's preference, else English. */
function initialLanguage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && CATALOGUES[saved]) return saved;
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return CATALOGUES[browser] ? browser : 'en';
}

function lookup(catalogue, key) {
  return key.split('.').reduce((node, part) => (node ? node[part] : undefined), catalogue);
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(initialLanguage);

  const setLanguage = useCallback((code) => {
    if (!CATALOGUES[code]) return;
    localStorage.setItem(STORAGE_KEY, code);
    setLanguageState(code);
    // Screen readers and browser features (hyphenation, spell-check) key off
    // this, so it has to follow the interface language.
    document.documentElement.lang = code;
  }, []);

  const t = useCallback(
    (key, values) => {
      // English is the fallback rather than the source of truth: a key missing
      // from Turkish shows English text, not a blank space.
      const raw = lookup(CATALOGUES[language], key) ?? lookup(CATALOGUES.en, key) ?? key;
      if (!values) return raw;
      return Object.entries(values).reduce(
        (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
        raw
      );
    },
    [language]
  );

  const value = useMemo(() => ({ t, language, setLanguage }), [t, language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Convenience for components that only need the lookup. */
export function useT() {
  return useI18n().t;
}
