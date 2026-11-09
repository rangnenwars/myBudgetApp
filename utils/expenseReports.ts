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
/**
 * One line for the top of the Categories view, from simple rules (no AI):
 * "Food is your top spend, up 18%". Says nothing when there are no expenses.
 */
export const topSpendInsight = (rows: CategoryRow[], labelOf: (category: string) => string): string | null => {
  const top = rows.find((r) => r.category !== OTHERS_KEY);
  if (!top || top.total <= 0) return null;
  const change = top.changePct == null || top.changePct === 0 ? '' : top.changePct > 0 ? `, up ${top.changePct}%` : `, down ${Math.abs(top.changePct)}%`;
  return `${labelOf(top.category)} is your top spend${change}`;
};

export interface MonthTotal {
  month: number;
  total: number;
}

/** One category's spending in each month of a year, January to December, from that year's transactions; empty months are 0. */
export const categoryByMonth = (transactions: { category: string; type: string; amount: number; month: number }[], category: string): MonthTotal[] => {
  const totals = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  for (const t of transactions) {
    if (t.type === 'expense' && t.category === category) totals[t.month - 1].total += t.amount;
  }
  return totals;
};

export interface MonthKey {
  month: number;
  year: number;
}

export interface PeriodRange {
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
}

/**
 * The months a Categories view covers, and the previous period to compare with.
 * A month is compared with the month before. A year is compared with the year
 * before; for the current year, which isn't over, both cover only the months so
 * far (January to this month), so the change compares like with like.
 */
export const categoryPeriod = (mode: 'month' | 'year', anchor: MonthKey, today: MonthKey): { current: PeriodRange; previous: PeriodRange } => {
  if (mode === 'month') {
    const prev = anchor.month === 1 ? { month: 12, year: anchor.year - 1 } : { month: anchor.month - 1, year: anchor.year };
    return {
      current: { startMonth: anchor.month, startYear: anchor.year, endMonth: anchor.month, endYear: anchor.year },
      previous: { startMonth: prev.month, startYear: prev.year, endMonth: prev.month, endYear: prev.year },
    };
  }
  const endMonth = anchor.year === today.year ? today.month : 12;
  return {
    current: { startMonth: 1, startYear: anchor.year, endMonth, endYear: anchor.year },
    previous: { startMonth: 1, startYear: anchor.year - 1, endMonth, endYear: anchor.year - 1 },
  };
};
