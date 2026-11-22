import { HI, HI_PATTERNS } from '../i18nHi';
import { LANGUAGES, dateLocale, getLanguage, interpolate, parseLanguage, setCurrentLanguage, t, translate, translateNode } from '../i18n';
import { MAX_STEPS, TOUR_STEPS, clampStep, stepButtons, stepsFor } from '../tour';

afterEach(() => setCurrentLanguage('en'));

describe('translate', () => {
  it('English is the default and returns the text unchanged', () => {
    expect(getLanguage()).toBe('en');
    expect(t('Add transaction')).toBe('Add transaction');
    expect(translate('Add transaction', 'en')).toBe('Add transaction');
  });

  it('Hindi returns the Hindi text', () => {
    expect(translate('Add transaction', 'hi')).toBe('लेन-देन जोड़ें');
    setCurrentLanguage('hi');
    expect(t('Cancel')).toBe('रद्द करें');
  });

  it('text with no Hindi falls back to the English text, never blank', () => {
    expect(translate('A sentence nobody has translated yet.', 'hi')).toBe('A sentence nobody has translated yet.');
    expect(translate('Rahul Sharma', 'hi')).toBe('Rahul Sharma'); // a name someone typed
    expect(translate('₹1,20,000', 'hi')).toBe('₹1,20,000');
  });

  it('spacing at the ends is kept while the words are translated', () => {
    expect(translate('Next: ', 'hi')).toBe(translate('Next:', 'hi') + ' ');
    expect(translate('  Cancel  ', 'hi')).toBe('  रद्द करें  ');
  });

  it('an empty string stays empty', () => {
    expect(translate('', 'hi')).toBe('');
  });
});

describe('interpolate', () => {
  it('fills placeholders by name or number', () => {
    expect(interpolate('Next: {0}', { 0: '5 Dec' })).toBe('Next: 5 Dec');
    expect(interpolate('{n} of {total}', { n: 2, total: 5 })).toBe('2 of 5');
  });
  it('leaves a placeholder with no value as written, and ignores extra values', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('Hello', { name: 'x' })).toBe('Hello');
  });
  it('the same placeholder can appear twice', () => {
    expect(interpolate('{0} and {0}', { 0: 'a' })).toBe('a and a');
  });
  it('a value that looks like a placeholder is not filled again', () => {
    expect(interpolate('Hi {0}', { 0: '{1}', 1: 'x' })).toBe('Hi {1}');
  });
  it('numbers keep their value, including zero', () => {
    expect(interpolate('{0} left', { 0: 0 })).toBe('0 left');
  });
});

describe('sentences with values, in both languages', () => {
  it('Hindi sentence with values', () => {
    expect(translate('Next: {0}', 'hi', { 0: '5 Dec' })).toBe('अगला: 5 Dec');
    expect(translate('{n} of {total}', 'hi', { n: 2, total: 5 })).toBe('5 में से 2');
  });
  it('the Hindi can move the values to where the sentence needs them', () => {
    expect(translate('{0} {1}, see the entries', 'hi', { 0: 'Rent', 1: '₹15,000' })).toBe('Rent ₹15,000, एंट्री देखें');
    expect(translate('Delete the {0} part payment of {1}? The balance, the EMI and its expense entry go back. This cannot be undone.', 'hi', { 0: '₹20,000', 1: '10 Nov' })).toContain('10 Nov');
  });
  it('a plural suffix passed in English is not glued onto Hindi', () => {
    expect(translate('Logged {0} expense{1} for this month.', 'hi', { 0: 3, 1: 's' })).toBe('इस महीने के लिए 3 खर्च दर्ज किए।');
  });
});

describe('server messages', () => {
  it('translates a fixed message', () => {
    expect(translate('Loan not found.', 'hi')).toBe('लोन नहीं मिला।');
  });
  it('translates a message that carries a value, keeping the value', () => {
    expect(translate("A part payment can't exceed the outstanding balance (100000).", 'hi')).toBe('पार्ट पेमेंट बकाया बैलेंस (100000) से ज़्यादा नहीं हो सकता।');
    expect(translate('"Pets" already exists.', 'hi')).toBe('"Pets" पहले से मौजूद है।');
    expect(translate('You can keep up to 200 people.', 'hi')).toBe('आप अधिकतम 200 लोग रख सकते हैं।');
  });
  it('a specific pattern wins over a general one', () => {
    expect(translate('Screenshot must be 2 MB or smaller.', 'hi')).toBe('स्क्रीनशॉट 2 MB या उससे छोटा होना चाहिए।');
    expect(translate('QR image must be 1 MB or smaller.', 'hi')).toBe('QR तस्वीर 1 MB या उससे छोटी होनी चाहिए।');
  });
  it('an unknown server message stays in English', () => {
    expect(translate('Something nobody wrote Hindi for.', 'hi')).toBe('Something nobody wrote Hindi for.');
  });
  it('patterns are anchored: a longer sentence that merely contains one is not rewritten', () => {
    const text = 'Please note: Invalid cursor.';
    expect(translate(text, 'hi')).toBe(text);
  });
});

describe('translateNode (the children of a Text)', () => {
  it('translates strings, in an array too, and leaves numbers and elements alone', () => {
    const element = { type: 'span' };
    expect(translateNode('Cancel', 'hi')).toBe('रद्द करें');
    expect(translateNode(['Cancel', 42, element, 'Save'], 'hi')).toEqual(['रद्द करें', 42, element, 'सेव करें']);
    expect(translateNode(null, 'hi')).toBeNull();
    expect(translateNode(undefined, 'hi')).toBeUndefined();
  });
  it('in English it returns the same children untouched', () => {
    const children = ['Cancel', 42];
    expect(translateNode(children, 'en')).toBe(children);
  });
});

describe('language helpers', () => {
  it('parseLanguage defaults to English for anything unknown', () => {
    expect(parseLanguage('hi')).toBe('hi');
    expect(parseLanguage('en')).toBe('en');
    expect(parseLanguage('fr')).toBe('en');
    expect(parseLanguage(null)).toBe('en');
    expect(parseLanguage(undefined)).toBe('en');
    expect(parseLanguage(5)).toBe('en');
  });
  it('lists English first, with the language names written in their own script', () => {
    expect(LANGUAGES.map((l) => l.key)).toEqual(['en', 'hi']);
    expect(LANGUAGES.find((l) => l.key === 'hi')!.label).toBe('हिन्दी');
  });
  it('the date locale follows the language', () => {
    expect(dateLocale('en')).toBe('en-IN');
    expect(dateLocale('hi')).toBe('hi-IN');
    setCurrentLanguage('hi');
    expect(dateLocale()).toBe('hi-IN');
  });
  it('a date in Hindi has Devanagari month names', () => {
    const text = new Date('2026-11-05T00:00:00').toLocaleDateString(dateLocale('hi'), { day: 'numeric', month: 'long' });
    expect(text).toMatch(/[ऀ-ॿ]/);
  });
});

describe('the dictionary itself', () => {
  const entries = Object.entries(HI);

  it('has no empty translations', () => {
    expect(entries.filter(([, v]) => !v.trim())).toEqual([]);
  });

  it('a translation never adds a placeholder the English does not have', () => {
    const bad = entries.filter(([k, v]) => {
      const english = new Set(k.match(/\{\w+\}/g) ?? []);
      return (v.match(/\{\w+\}/g) ?? []).some((p) => !english.has(p));
    });
    expect(bad).toEqual([]);
  });

  it('a translation keeps the placeholders a sentence needs (numbers named in the English survive)', () => {
    // Only plural suffixes (a trailing 's' passed as a value) may be dropped.
    const dropped = entries.filter(([k, v]) => (k.match(/\{\w+\}/g) ?? []).some((p) => !v.includes(p)));
    for (const [k] of dropped) expect(k).toMatch(/\{\d\}(?=[^A-Za-z]|$)/);
    expect(dropped.length).toBeLessThan(25);
  });

  it('Hindi keeps the finance words people say in English', () => {
    for (const word of ['EMI', 'SIP', 'UPI']) {
      const sample = entries.find(([k]) => k.includes(word) && k.length < 40);
      if (sample) expect(sample[1]).toContain(word);
    }
  });

  it('every pattern is anchored at both ends', () => {
    for (const [pattern] of HI_PATTERNS) expect(pattern.source.startsWith('^') && pattern.source.endsWith('$')).toBe(true);
  });

  it('a translation is written in Devanagari (or is a code or name left as is)', () => {
    const noDevanagari = entries.filter(([, v]) => !/[ऀ-ॿ]/.test(v));
    // Words like "Pro" or a bare "EMI" are allowed to stay.
    for (const [, v] of noDevanagari) expect(v.length).toBeLessThan(30);
  });
});

describe('the tour', () => {
  it('has a title and a body on every step, a unique key, and never more steps than the server accepts', () => {
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(MAX_STEPS);
    expect(new Set(TOUR_STEPS.map((s) => s.key)).size).toBe(TOUR_STEPS.length);
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.body.length).toBeGreaterThan(20);
    }
  });

  it('every tour card has Hindi', () => {
    for (const s of TOUR_STEPS) {
      expect(HI[s.title]).toBeTruthy();
      expect(HI[s.body]).toBeTruthy();
    }
  });

  it('does not talk about price, free months or plans', () => {
    const text = TOUR_STEPS.map((s) => s.title + ' ' + s.body).join(' ');
    expect(text).not.toMatch(/₹|free|paid|price|plan\b|trial|subscription|pay\b|Pro\b/i);
  });

  it('Skip is on every card except the last; Back only in the middle; Next until the last', () => {
    expect(stepButtons(0, 5)).toEqual({ back: false, next: true, skip: true });
    expect(stepButtons(2, 5)).toEqual({ back: true, next: true, skip: true });
    expect(stepButtons(3, 5)).toEqual({ back: true, next: true, skip: true });
    expect(stepButtons(4, 5)).toEqual({ back: false, next: false, skip: false });
    expect(stepButtons(17, 18)).toEqual({ back: false, next: false, skip: false });
  });

  it('clampStep keeps a card number inside the tour', () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(99)).toBe(TOUR_STEPS.length - 1);
    expect(clampStep(99, 5)).toBe(4);
    expect(clampStep(2.7)).toBe(2);
    expect(clampStep(Number.NaN)).toBe(0);
  });
});
