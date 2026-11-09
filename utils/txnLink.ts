// Tap-through to Transactions: a figure on Home or Reports opens the entries
// behind it. The target is the Transactions tab with the filters as route params.

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TxnFilter {
  type?: 'income' | 'expense';
  category?: string;
  /** Inclusive YYYY-MM-DD bounds. */
  from?: string;
  to?: string;
  /** What the date chip says, e.g. "Oct 2026". */
  label?: string;
}

/** First and last day of a month. */
export const monthBounds = (year: number, month: number): { from: string; to: string } => ({
  from: `${year}-${pad(month)}-01`,
  to: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`,
});

export const monthText = (year: number, month: number): string => `${MONTHS[month - 1]} ${year}`;

/** First day of the first month to last day of the last month. */
export const rangeBounds = (startMonth: number, startYear: number, endMonth: number, endYear: number): { from: string; to: string; label: string } => ({
  from: monthBounds(startYear, startMonth).from,
  to: monthBounds(endYear, endMonth).to,
  label: startMonth === endMonth && startYear === endYear ? monthText(startYear, startMonth) : `${monthText(startYear, startMonth)} to ${monthText(endYear, endMonth)}`,
});

/** Filters for one month, ready for `txnLink`. */
export const monthFilter = (year: number, month: number, extra: Pick<TxnFilter, 'type' | 'category'> = {}): TxnFilter => ({
  ...extra,
  ...monthBounds(year, month),
  label: monthText(year, month),
});

/**
 * Route to open Transactions with these filters. `n` changes on every call so
 * tapping the same figure twice (after clearing the filters) still re-applies it.
 */
export const txnLink = (filter: TxnFilter, now: number = Date.now()) => ({
  pathname: '/(tabs)/transactions' as const,
  params: {
    ...(Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>),
    n: String(now),
  },
});

/** The filters carried by Transactions' route params, or null when it was opened plainly. */
export const filterFromParams = (params: Record<string, string | string[] | undefined>): (TxnFilter & { n: string }) | null => {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const n = one(params.n);
  if (!n) return null;
  const type = one(params.type);
  return {
    n,
    type: type === 'income' || type === 'expense' ? type : undefined,
    category: one(params.category) || undefined,
    from: one(params.from) || undefined,
    to: one(params.to) || undefined,
    label: one(params.label) || undefined,
  };
};
