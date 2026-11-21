import { HI, HI_PATTERNS } from './i18nHi';

// Translation without keys: the English text itself is the key. A missing translation falls back to
// the English text, so a screen never shows a blank or a code. English is the default language.
//
// Every <Text> and <TextInput placeholder> in the app goes through here (components/i18n), so
// text added to a screen is translated by adding one line to utils/i18nHi.ts. The coverage test
// (utils/__tests__/i18nCoverage.test.ts) fails when a new piece of text has no Hindi.

export type Language = 'en' | 'hi';

export const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'en', label: 'English' },
  { key: 'hi', label: 'हिन्दी' },
];

export const parseLanguage = (value: unknown): Language => (value === 'hi' ? 'hi' : 'en');

// The language the next call to t() uses. The React tree re-renders from LanguageContext; this plain
// copy is for code that runs outside a render (alerts, error messages built in a handler).
let current: Language = 'en';
export const getLanguage = (): Language => current;
export const setCurrentLanguage = (lang: Language): void => {
  current = lang;
};

/** Fills {name} placeholders. A placeholder with no value is left as written. */
export const interpolate = (text: string, vars?: Record<string, string | number>): string =>
  vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;

const lookup = (text: string): string => {
  const exact = HI[text];
  if (exact !== undefined) return exact;
  // JSX often leaves a space at either end ("Next: "): match the words, keep the spacing.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (m && (m[1] || m[3]) && m[2]) {
    const inner = HI[m[2]];
    if (inner !== undefined) return m[1] + inner + m[3];
  }
  for (const [pattern, template] of HI_PATTERNS) {
    if (pattern.test(text)) return text.replace(pattern, template);
  }
  return text;
};

/** The text in `lang`, with {name} placeholders filled. Falls back to the English text. */
export const translate = (text: string, lang: Language, vars?: Record<string, string | number>): string => {
  if (!text) return text;
  if (lang !== 'hi') return interpolate(text, vars);
  // A value that is itself a known word ('days', 'at sign-up') is translated too; names and amounts stay as they are.
  const values = vars && Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, typeof value === 'string' ? (HI[value] ?? value) : value]));
  return interpolate(lookup(text), values);
};

/** Translate in the current language. For text built in a handler, not for <Text> (that translates itself). */
export const t = (text: string, vars?: Record<string, string | number>): string => translate(text, current, vars);

/** Translate every string among some React children, leaving numbers and elements alone. */
export const translateNode = (children: unknown, lang: Language): unknown => {
  if (lang === 'en') return children;
  if (typeof children === 'string') return translate(children, lang);
  if (Array.isArray(children)) return children.map((c) => translateNode(c, lang));
  return children;
};

/** Locale for dates: month and day names come out in Devanagari in Hindi. Numbers keep en-IN grouping. */
export const dateLocale = (lang: Language = current): string => (lang === 'hi' ? 'hi-IN' : 'en-IN');
