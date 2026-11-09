// Month-wise and category-wise expense views (Reports > Monthly / Categories).
// The totals themselves come from the server's existing monthly series and
// category breakdown, the same source as Home and the Transactions filter;
// this file only works out the percentages, bars and "Others" grouping.

import { CategoryTotal } from './types';

/** Key of the combined "Others" row. */
export const OTHERS_KEY = '__others';

/** Percent change from `previous` to `current`, rounded; null when there is no baseline (previous is 0). */
export const changePct = (current: number, previous: number | null | undefined): number | null => {
  if (previous == null || !(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
};

/** "+12%", "-5%" or "0%". */
export const changeText = (pct: number): string => `${pct > 0 ? '+' : ''}${pct}%`;

export interface MonthExpenseInput {
  year: number;
  month: number;
  label: string;
  expense: number;
}

export interface MonthlyExpenseRow {
  year: number;
  month: number;
  label: string;
  total: number;
  /** vs the month before; null when that month had no expenses (so there's nothing to compare with). */
  changePct: number | null;
  /** Length of the bar, 0 to 100, relative to the highest month shown. */
  barPct: number;
}

/**
 * Rows for the monthly list, newest first. `series` is oldest to newest; its
 * first month is only the baseline for the first row's % change, so it is not
 * listed (pass `withBaseline: false` to list every month). Months with no
 * expenses stay in the list as 0.
 */
export const monthlyExpenseRows = (
  series: MonthExpenseInput[],
  withBaseline = true
): { rows: MonthlyExpenseRow[]; average: number; highest: MonthlyExpenseRow | null } => {
  const shown = withBaseline ? series.slice(1) : series;
  const max = Math.max(0, ...shown.map((m) => m.expense));
  const rows = shown.map((m, i) => {
    const prev = withBaseline ? series[i] : series[i - 1];
    return {
      year: m.year,
      month: m.month,
      label: m.label,
      total: m.expense,
      changePct: changePct(m.expense, prev?.expense),
      barPct: max > 0 ? (m.expense / max) * 100 : 0,
    };
  });
  const average = rows.length ? rows.reduce((s, r) => s + r.total, 0) / rows.length : 0;
  const highest = max > 0 ? rows.reduce((best, r) => (r.total > best.total ? r : best), rows[0]) : null;
  return { rows: rows.reverse(), average, highest };
};

export interface CategoryRow {
  /** Category key, or OTHERS_KEY for the combined row. */
  category: string;
  total: number;
  /** Share of the period total, rounded. */
  sharePct: number;
  /** vs the same category in the previous period; null when it had nothing then. */
  changePct: number | null;
  barPct: number;
}

/**
 * Categories for a period, largest first, with the smallest folded into one
 * "Others" row. A category the app doesn't recognise (deleted, or never
 * categorised) always goes into Others. The rows add up to the period total.
 * `previous` is the same breakdown for the previous period, for the % change.
 */
export const categoryRows = (
  current: CategoryTotal[],
  previous: CategoryTotal[] | null,
  keep: number,
  isKnown: (category: string) => boolean
): { total: number; rows: CategoryRow[] } => {
  const total = current.reduce((s, c) => s + c.total, 0);
  const sorted = [...current].sort((a, b) => b.total - a.total);
  const known = sorted.filter((c) => isKnown(c.category));
  const kept = known.slice(0, keep);
  const keptKeys = new Set(kept.map((c) => c.category));
  const folded = sorted.filter((c) => !keptKeys.has(c.category));

  const prevMap = new Map((previous ?? []).map((c) => [c.category, c.total]));
  const entries: { category: string; total: number; prev: number | null }[] = kept.map((c) => ({ category: c.category, total: c.total, prev: previous ? prevMap.get(c.category) ?? 0 : null }));
  if (folded.length > 0) {
    entries.push({
      category: OTHERS_KEY,
      total: folded.reduce((s, c) => s + c.total, 0),
      prev: previous ? folded.reduce((s, c) => s + (prevMap.get(c.category) ?? 0), 0) : null,
    });
  }
  const max = Math.max(0, ...entries.map((e) => e.total));
  return {
    total,
    rows: entries.map((e) => ({
      category: e.category,
      total: e.total,
      sharePct: total > 0 ? Math.round((e.total / total) * 100) : 0,
      changePct: e.prev == null ? null : changePct(e.total, e.prev),
      barPct: max > 0 ? (e.total / max) * 100 : 0,
    })),
  };
};
