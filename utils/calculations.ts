// Pure, storage-agnostic business logic. No SQLite, no localStorage, no
// Platform checks — everything here takes plain arrays/values in and
// returns plain values out, so it runs identically (and is unit-testable)
// regardless of native vs. web storage backend.

import { Transaction, TxnType, Loan, Investment, SavingsGoal, MonthSummary, CategoryTotal } from './types';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type BudgetClass = 'low' | 'middle' | 'high' | 'ultra_high' | 'rich';
export type DebtStrategy = 'snowball' | 'avalanche';

// ---------- Budget class ----------
// Spec: real budget class is server-computed only. Without a server this is
// a local estimate purely for the Standard-tier UI badge.
export const classifyLocal = (avgMonthlyOutflow: number): BudgetClass => {
  if (avgMonthlyOutflow < 30_000) return 'low';
  if (avgMonthlyOutflow < 100_000) return 'middle';
  if (avgMonthlyOutflow < 300_000) return 'high';
  if (avgMonthlyOutflow < 1_000_000) return 'ultra_high';
  return 'rich';
};

// ---------- Month / category aggregation ----------

export const computeMonthSummary = (transactions: Transaction[]): MonthSummary => {
  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { totalIncome, totalExpense, netSavings: totalIncome - totalExpense };
};

export const computeCategoryBreakdown = (transactions: Transaction[], type: TxnType): CategoryTotal[] => {
  const filtered = transactions.filter((t) => t.type === type);
  const totals = new Map<string, number>();
  for (const t of filtered) totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
};

export const computeSavingsRate = (summary: MonthSummary): number => {
  if (summary.totalIncome <= 0) return 0;
  return (summary.netSavings / summary.totalIncome) * 100;
};

// ---------- Month range / trend series ----------

export interface MonthKey {
  month: number;
  year: number;
}

export interface MonthPoint extends MonthKey {
  label: string;
  income: number;
  expense: number;
  net: number;
}

export const formatMonthLabel = (month: number, year: number): string => `${MONTH_LABELS[month - 1]} ${year}`;

/** Inclusive list of {month, year} from start to end. Returns [] if the range is reversed. */
export const generateMonthRange = (startMonth: number, startYear: number, endMonth: number, endYear: number): MonthKey[] => {
  const points: MonthKey[] = [];
  let m = startMonth;
  let y = startYear;
  let guard = 0;
  while ((y < endYear || (y === endYear && m <= endMonth)) && guard < 1200) {
    points.push({ month: m, year: y });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    guard++;
  }
  return points;
};

export const computeMonthlySeries = (transactions: Transaction[], range: MonthKey[]): MonthPoint[] => {
  return range.map(({ month, year }) => {
    const txns = transactions.filter((t) => t.month === month && t.year === year);
    const summary = computeMonthSummary(txns);
    return { month, year, label: formatMonthLabel(month, year), income: summary.totalIncome, expense: summary.totalExpense, net: summary.netSavings };
  });
};

// ---------- Category month-over-month deltas ----------

export interface CategoryDelta {
  category: string;
  current: number;
  previous: number;
  deltaAmount: number;
  /** null when there's no previous-period baseline to compare against (new category) */
  deltaPct: number | null;
}

export const computeCategoryDeltas = (currentTxns: Transaction[], previousTxns: Transaction[], type: TxnType): CategoryDelta[] => {
  const currentMap = new Map(computeCategoryBreakdown(currentTxns, type).map((c) => [c.category, c.total]));
  const previousMap = new Map(computeCategoryBreakdown(previousTxns, type).map((c) => [c.category, c.total]));
  const categories = new Set([...currentMap.keys(), ...previousMap.keys()]);

  return [...categories]
    .map((category) => {
      const current = currentMap.get(category) ?? 0;
      const previous = previousMap.get(category) ?? 0;
      const deltaAmount = current - previous;
      const deltaPct = previous > 0 ? (deltaAmount / previous) * 100 : null;
      return { category, current, previous, deltaAmount, deltaPct };
    })
    .sort((a, b) => b.deltaAmount - a.deltaAmount);
};

// ---------- Net worth ----------

export const computeNetWorth = (investments: Investment[], goals: SavingsGoal[], loans: Loan[]): number => {
  const investmentsValue = investments.reduce((s, i) => s + (i.current_value ?? i.amount), 0);
  const goalsValue = goals.reduce((s, g) => s + g.saved_amount, 0);
  const loansValue = loans.reduce((s, l) => s + l.outstanding, 0);
  return investmentsValue + goalsValue - loansValue;
};

// ---------- Debt payoff planning ----------

const addMonthsIso = (from: Date, months: number): string => {
  const d = new Date(from.getFullYear(), from.getMonth() + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Priority order a strategy pays debts down in. Snowball = smallest balance first; avalanche = highest interest rate first. */
export const computeDebtOrder = (loans: Loan[], strategy: DebtStrategy): Loan[] => {
  const active = loans.filter((l) => l.outstanding > 0);
  if (strategy === 'avalanche') {
    return [...active].sort((a, b) => (b.interest_rate ?? 0) - (a.interest_rate ?? 0));
  }
  return [...active].sort((a, b) => a.outstanding - b.outstanding);
};

export interface DebtPayoffResult {
  loanId: number;
  name: string;
  payoffMonths: number;
  payoffDate: string; // YYYY-MM
}

const MAX_SIMULATION_MONTHS = 1200; // 100-year safety cap against non-terminating simulations

/**
 * Simulates minimum payments on every loan, snowballing/avalanching any
 * `extraPerMonth` plus each paid-off loan's freed-up EMI onto the next loan
 * in priority order. Returns one result per loan that actually gets paid
 * off within the cap; loans whose EMI can't outpace their balance never
 * appear in the result (division-by-zero-style non-termination is avoided
 * by the month cap rather than by detecting it analytically).
 */
export const simulateDebtPayoff = (loans: Loan[], strategy: DebtStrategy, extraPerMonth = 0, fromDate: Date = new Date()): DebtPayoffResult[] => {
  const order = computeDebtOrder(loans, strategy);
  if (order.length === 0) return [];

  const balances = new Map(order.map((l) => [l.id, l.outstanding]));
  const results: DebtPayoffResult[] = [];
  let freedEmi = 0;
  let month = 0;

  while (results.length < order.length && month < MAX_SIMULATION_MONTHS) {
    month++;
    let extraApplied = false;
    for (const loan of order) {
      const bal = balances.get(loan.id)!;
      if (bal <= 0) continue;
      let payment = loan.emi;
      if (!extraApplied) {
        payment += extraPerMonth + freedEmi;
        extraApplied = true;
      }
      const next = bal - payment;
      balances.set(loan.id, next);
      if (next <= 0) {
        results.push({ loanId: loan.id, name: loan.name, payoffMonths: month, payoffDate: addMonthsIso(fromDate, month) });
        freedEmi += loan.emi;
      }
    }
  }

  return results;
};

// ---------- Goal ETA ----------

export interface GoalETA {
  monthsRemaining: number | null;
  etaDate: string | null; // YYYY-MM
}

export const computeGoalETA = (goal: SavingsGoal, avgMonthlySavings: number, fromDate: Date = new Date()): GoalETA => {
  const remaining = goal.target_amount - goal.saved_amount;
  if (remaining <= 0) return { monthsRemaining: 0, etaDate: addMonthsIso(fromDate, 0) };
  if (avgMonthlySavings <= 0) return { monthsRemaining: null, etaDate: null };
  const months = Math.ceil(remaining / avgMonthlySavings);
  return { monthsRemaining: months, etaDate: addMonthsIso(fromDate, months) };
};

// ---------- Bulk expense entry (Input Expenses screen) ----------

export type EntryPeriod = 'monthly' | 'quarterly' | 'yearly';
export type CategoryBucket = 'expense' | 'loan' | 'investment';

const LOAN_GROUPS = new Set(['Loans & EMIs', 'Credit cards']);
const INVESTMENT_GROUPS = new Set(['Investments & savings']);

/** Classifies a category's display group into the coarse bucket shown on the Input Expenses row and the Dashboard breakdown. */
export const bucketForGroup = (group: string): CategoryBucket => {
  if (LOAN_GROUPS.has(group)) return 'loan';
  if (INVESTMENT_GROUPS.has(group)) return 'investment';
  return 'expense';
};

/** Converts a quarterly/yearly bill into its monthly-equivalent budget impact. Monthly passes through unchanged. */
export const monthlyEquivalent = (amount: number, period: EntryPeriod): number => {
  if (period === 'quarterly') return amount / 3;
  if (period === 'yearly') return amount / 12;
  return amount;
};

// ---------- CSV export ----------

const csvEscape = (value: string | number | null | undefined): string => {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS: (keyof Transaction)[] = ['date', 'type', 'category', 'amount', 'note'];

/** Header + one row per transaction, in the given order (caller sorts beforehand). */
export const transactionsToCsv = (transactions: Transaction[]): string => {
  const header = CSV_COLUMNS.join(',');
  const rows = transactions.map((t) => CSV_COLUMNS.map((col) => csvEscape(t[col] as string | number | null)).join(','));
  return [header, ...rows].join('\n');
};
