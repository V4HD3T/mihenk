/**
 * Locale-aware formatting for values the catalogues can't hold.
 *
 * Dates were formatted with a hardcoded 'en-US' in seven places, which is
 * worse than untranslated text: "03/04/2026" is 4 March to a Turkish reader
 * and 3 April to an American one, and nothing on screen says which was meant.
 * An exam start time that reads as the wrong month is a real problem.
 */

const DATE_LOCALES = { tr: 'tr-TR', en: 'en-US' };

/** BCP 47 tag for the interface language, defaulting to English. */
export function dateLocale(language) {
  return DATE_LOCALES[language] ?? DATE_LOCALES.en;
}
