// The pages of the app, as patterns. Page-hit logging records only one of these, never the real address:
// ids, months and category keys in a web address are replaced by [id], [ym] and [category], and anything
// that is not a known page is dropped. So what a person opened, searched for or typed can never end up in
// the log. Shared by the app (which reports the hits) and the server (which checks them again).

export interface PageInfo {
  pattern: string;
  /** What an admin reads in the activity screens. */
  label: string;
}

export const PAGES: readonly PageInfo[] = [
  { pattern: '/', label: 'Home' },
  { pattern: '/transactions', label: 'Transactions' },
  { pattern: '/loans', label: 'Loans' },
  { pattern: '/investments', label: 'Investments' },
  { pattern: '/goals', label: 'Goals' },
  { pattern: '/reports', label: 'Reports' },
  { pattern: '/accounts', label: 'Accounts' },
  { pattern: '/budgets', label: 'Budgets' },
  { pattern: '/free-money-day', label: 'Free-money day' },
  { pattern: '/input-expenses', label: 'Input expenses' },
  { pattern: '/loan-payments', label: 'Loan payments' },
  { pattern: '/monthly-expenses/[ym]', label: 'Monthly expenses' },
  { pattern: '/category-trend/[category]', label: 'Category trend' },
  { pattern: '/more-features', label: 'More features' },
  { pattern: '/people', label: 'People' },
  { pattern: '/people/[id]', label: 'A person' },
  { pattern: '/people/split', label: 'Split a bill' },
  { pattern: '/plan-ahead', label: 'Plan ahead' },
  { pattern: '/plan-ahead/[ym]', label: 'Plan ahead, one month' },
  { pattern: '/plan', label: 'Your plan' },
  { pattern: '/renew', label: 'Renew' },
  { pattern: '/report-issue', label: 'Report an issue' },
  { pattern: '/settings', label: 'Settings' },
  { pattern: '/sign-in-history', label: 'My sign-in history' },
  { pattern: '/legal/privacy', label: 'Privacy policy' },
  { pattern: '/legal/terms', label: 'Terms of use' },
  { pattern: '/login', label: 'Sign in' },
  { pattern: '/register', label: 'Create account' },
  { pattern: '/forgot-password', label: 'Forgot password' },
  { pattern: '/reset-password', label: 'Reset password' },
  { pattern: '/verify-email', label: 'Confirm email' },
  { pattern: '/admin', label: 'Admin' },
  { pattern: '/admin/audit-log', label: 'Audit log' },
  { pattern: '/admin/exceptions', label: 'Exceptions' },
  { pattern: '/admin/features', label: 'Feature access' },
  { pattern: '/admin/metrics', label: 'System metrics' },
  { pattern: '/admin/payment-details', label: 'Payment details' },
  { pattern: '/admin/payments', label: 'Payments to confirm' },
  { pattern: '/admin/plan', label: 'Plan and pricing' },
  { pattern: '/admin/activity', label: 'User activity' },
  { pattern: '/admin/activity-user', label: 'One person’s activity' },
];

const STATIC = new Set(PAGES.filter((p) => !p.pattern.includes('[')).map((p) => p.pattern));
const LABELS = new Map(PAGES.map((p) => [p.pattern, p.label]));

/** Longest path accepted before looking at it at all. */
export const MAX_PATH_LENGTH = 200;

/**
 * The page pattern for a web address, or null when it is not a known page. Query strings, hashes and a
 * trailing slash are ignored. A path with a dynamic part must have the right shape (digits for an id,
 * YYYY-MM for a month, a lower-case key for a category), so free text never matches.
 */
export const normalizePage = (path: unknown): string | null => {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return null;
  let p = path.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) return null;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '' || p === '/index') return '/';
  if (STATIC.has(p)) return p;
  if (/^\/people\/\d{1,15}$/.test(p)) return '/people/[id]';
  if (/^\/monthly-expenses\/\d{4}-\d{2}$/.test(p)) return '/monthly-expenses/[ym]';
  if (/^\/plan-ahead\/\d{4}-\d{2}$/.test(p)) return '/plan-ahead/[ym]';
  if (/^\/category-trend\/[a-z0-9_]{1,64}$/.test(p)) return '/category-trend/[category]';
  return null;
};

/** What to call a page pattern in an admin screen. Unknown patterns are shown as written. */
export const pageLabel = (pattern: string): string => LABELS.get(pattern) ?? pattern;

/** True when `pattern` is one of the known patterns exactly (what the server stores). */
export const isKnownPattern = (pattern: unknown): pattern is string => typeof pattern === 'string' && LABELS.has(pattern);
