declare const require: (m: string) => any;
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
import { MAX_PATH_LENGTH, PAGES, isKnownPattern, normalizePage, pageLabel } from '../pagePatterns';

describe('normalizePage', () => {
  it.each([
    ['/', '/'],
    ['/index', '/'],
    ['/transactions', '/transactions'],
    ['/transactions/', '/transactions'],
    ['/transactions?month=5&q=salary', '/transactions'],
    ['/transactions#top', '/transactions'],
    ['/settings?x=1#y', '/settings'],
    ['/admin/audit-log', '/admin/audit-log'],
    ['/legal/privacy', '/legal/privacy'],
  ])('%s is %s', (input, expected) => {
    expect(normalizePage(input)).toBe(expected);
  });

  it('replaces ids, months and category keys, so the real value is never kept', () => {
    expect(normalizePage('/people/42')).toBe('/people/[id]');
    expect(normalizePage('/people/42?from=home')).toBe('/people/[id]');
    expect(normalizePage('/monthly-expenses/2026-11')).toBe('/monthly-expenses/[ym]');
    expect(normalizePage('/plan-ahead/2027-02')).toBe('/plan-ahead/[ym]');
    expect(normalizePage('/category-trend/groceries_milk')).toBe('/category-trend/[category]');
  });

  it('a fixed page wins over a dynamic one with the same start', () => {
    expect(normalizePage('/people/split')).toBe('/people/split');
    expect(normalizePage('/plan-ahead')).toBe('/plan-ahead');
  });

  it.each([
    '/people/abc',
    '/people/42/edit',
    '/people/-1',
    '/people/12345678901234567890',
    '/monthly-expenses/2026-1',
    '/monthly-expenses/november',
    '/category-trend/Rent Money',
    '/category-trend/a/b',
    '/nope',
    '/admin/secret',
    '/Transactions',
    'transactions',
    '',
    'https://evil.example/transactions',
    '//transactions',
    '/transactions/../admin',
    '/people/<script>',
  ])('drops %p', (input) => {
    expect(normalizePage(input)).toBeNull();
  });

  it('drops anything that is not text, and anything too long', () => {
    for (const v of [null, undefined, 5, {}, [], true]) expect(normalizePage(v)).toBeNull();
    expect(normalizePage('/' + 'a'.repeat(MAX_PATH_LENGTH))).toBeNull();
  });

  it('what it returns is always a known pattern', () => {
    for (const p of ['/', '/transactions', '/people/9', '/monthly-expenses/2026-11', '/category-trend/x']) expect(isKnownPattern(normalizePage(p))).toBe(true);
  });
});

describe('page labels', () => {
  it('every pattern has a label and a pattern appears once', () => {
    expect(new Set(PAGES.map((p) => p.pattern)).size).toBe(PAGES.length);
    for (const p of PAGES) expect(p.label.length).toBeGreaterThan(2);
  });
  it('an unknown pattern is shown as written', () => {
    expect(pageLabel('/transactions')).toBe('Transactions');
    expect(pageLabel('/mystery')).toBe('/mystery');
  });
  it('isKnownPattern is exact', () => {
    expect(isKnownPattern('/people/[id]')).toBe(true);
    expect(isKnownPattern('/people/5')).toBe(false);
    expect(isKnownPattern(7)).toBe(false);
  });
});

describe('every screen in the app has a page pattern', () => {
  const root = path.join(__dirname, '..', '..', 'app');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') && entry.name !== '_layout.tsx') files.push(full);
    }
  };
  walk(root);

  // app/(tabs)/goals.tsx is /goals, app/people/[id].tsx is /people/<id>, app/index.tsx is /.
  const urlOf = (file: string) => {
    let rel = path.relative(root, file).replace(/\\/g, '/').replace(/\.tsx$/, '');
    rel = rel.replace(/\([^)]*\)\//g, '');
    rel = rel.replace(/\[ym\]/, '2026-11').replace(/\[category\]/, 'food').replace(/\[id\]/, '7');
    rel = rel.replace(/(^|\/)index$/, '');
    return '/' + rel;
  };

  it('finds the screens', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files.map((f) => [path.relative(root, f).replace(/\\/g, '/'), urlOf(f)]))('%s is %s', (_file, url) => {
    expect(normalizePage(url)).not.toBeNull();
  });
});
