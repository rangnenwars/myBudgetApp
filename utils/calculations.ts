// Pure, storage-agnostic business logic. No SQLite, no localStorage, no
// Platform checks — everything here takes plain arrays/values in and
// returns plain values out, so it runs identically (and is unit-testable)
// regardless of native vs. web storage backend.

import { Transaction, TxnType, Loan, Investment, SavingsGoal, MonthSummary, CategoryTotal, Account } from './types';

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

/**
 * The fields the aggregation functions read. A real transaction fits, and so
 * does a pre-summed row (one per month/type/category) — which is what the
 * server passes, so reports never load a user's individual transactions.
 */
export type TxnTotals = Pick<Transaction, 'type' | 'amount' | 'category' | 'month' | 'year'>;

export const computeMonthSummary = (transactions: TxnTotals[]): MonthSummary => {
  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { totalIncome, totalExpense, netSavings: totalIncome - totalExpense };
};

export const computeCategoryBreakdown = (transactions: TxnTotals[], type: TxnType): CategoryTotal[] => {
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

export const computeMonthlySeries = (transactions: TxnTotals[], range: MonthKey[]): MonthPoint[] => {
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

export const computeCategoryDeltas = (currentTxns: TxnTotals[], previousTxns: TxnTotals[], type: TxnType): CategoryDelta[] => {
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

/** Assets (investments at current value, goal savings, bank/cash/wallet balances) minus debts (loan balances, credit-card dues). */
export const computeNetWorth = (investments: Investment[], goals: SavingsGoal[], loans: Loan[], accounts: Pick<Account, 'type' | 'balance'>[] = []): number => {
  const investmentsValue = investments.reduce((s, i) => s + (i.current_value ?? i.amount), 0);
  const goalsValue = goals.reduce((s, g) => s + g.saved_amount, 0);
  const loansValue = loans.reduce((s, l) => s + l.outstanding, 0);
  const accountsValue = accounts.reduce((s, a) => s + (a.type === 'credit_card' ? -a.balance : a.balance), 0);
  return investmentsValue + goalsValue + accountsValue - loansValue;
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
 * Simulates the months ahead on a reducing balance: each month every loan
 * accrues interest (rate ÷ 12, none when no rate is set) and is paid its EMI;
 * `extraPerMonth` plus every paid-off loan's freed-up EMI goes to the
 * highest-priority loan still open (snowball: smallest balance first,
 * avalanche: highest rate first). Money left over when a loan clears rolls
 * on to the next loan in the same month instead of being lost. Returns one
 * result per loan paid off within the 100-year cap; a loan whose payments
 * never outpace its interest doesn't appear.
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
    // Interest first, on every open loan.
    for (const loan of order) {
      const bal = balances.get(loan.id)!;
      if (bal > 0) balances.set(loan.id, bal + (bal * (loan.interest_rate ?? 0)) / 1200);
    }
    // The pool (extra + freed EMIs + any overpayment) goes to the first open loan in priority order.
    let pool = extraPerMonth + freedEmi;
    for (const loan of order) {
      const bal = balances.get(loan.id)!;
      if (bal <= 0) continue;
      const payment = loan.emi + pool;
      pool = 0;
      const next = bal - payment;
      if (next <= 0.005) {
        balances.set(loan.id, 0);
        results.push({ loanId: loan.id, name: loan.name, payoffMonths: month, payoffDate: addMonthsIso(fromDate, month) });
        freedEmi += loan.emi;
        pool = -next; // overpayment rolls on to the next loan this month
      } else {
        balances.set(loan.id, next);
      }
    }
  }

  return results;
};

// ---------- Loan part payment ----------

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface PartPaymentResult {
  outstanding: number;
  emi: number;
  /** Instalments left at the new EMI — the same figure the Loans screen shows as "N mo left". null when fully paid. */
  monthsLeft: number | null;
}

/**
 * Applies a part payment to a loan: the outstanding balance drops by `amount`
 * and the EMI is scaled by the same ratio, which keeps the remaining number of
 * instalments unchanged (for a fixed-rate loan the EMI is linear in the
 * outstanding principal, so this is exact rather than an approximation). A
 * payment that clears the balance leaves the EMI as-is — the stored EMI must
 * stay positive. Callers validate 0 < amount <= outstanding.
 */
export const computePartPayment = (loan: Pick<Loan, 'outstanding' | 'emi'>, amount: number): PartPaymentResult => {
  const outstanding = round2(loan.outstanding - amount);
  if (outstanding <= 0) return { outstanding: 0, emi: loan.emi, monthsLeft: null };
  const emi = Math.max(0.01, round2(loan.emi * (outstanding / loan.outstanding)));
  return { outstanding, emi, monthsLeft: Math.ceil(outstanding / emi) };
};

// ---------- EMI principal / interest split ----------

export interface EmiSplit {
  /** What is actually paid this month — the EMI, or less on the final instalment. */
  payment: number;
  interest: number;
  principal: number;
  /** Balance after this instalment. */
  outstanding: number;
}

/**
 * One month of a reducing-balance loan: interest accrues on the outstanding
 * balance at annualRatePercent / 12, the rest of the EMI repays principal.
 * The final instalment is capped at balance + interest. If the EMI doesn't
 * even cover the interest, no principal is repaid (the balance is held, not
 * grown — the app tracks what the user pays, not the lender's penalties).
 * A null/zero rate means the whole EMI is principal.
 */
export const splitEmi = (outstanding: number, annualRatePercent: number | null, emi: number): EmiSplit => {
  if (outstanding <= 0) return { payment: 0, interest: 0, principal: 0, outstanding: 0 };
  const interest = round2((outstanding * (annualRatePercent ?? 0)) / 1200);
  const payment = round2(Math.min(emi, outstanding + interest));
  const principal = round2(Math.max(0, payment - interest));
  return { payment, interest: round2(payment - principal), principal, outstanding: round2(Math.max(0, outstanding - principal)) };
};

/** Instalments left at this EMI on a reducing balance, or null if the EMI doesn't cover the monthly interest (it would never be repaid). Capped at 100 years. */
export const monthsToRepay = (outstanding: number, annualRatePercent: number | null, emi: number): number | null => {
  let balance = outstanding;
  let months = 0;
  while (balance > 0) {
    const split = splitEmi(balance, annualRatePercent, emi);
    if (split.principal <= 0 || months >= MAX_SIMULATION_MONTHS) return null;
    balance = split.outstanding;
    months++;
  }
  return months;
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
  let s = value == null ? '' : String(value);
  // A text cell starting with = + - @ (or tab/CR) runs as a formula in Excel/Sheets — prefix a quote so it stays text.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS: (keyof Transaction)[] = ['date', 'type', 'category', 'amount', 'note'];

export const CSV_HEADER = CSV_COLUMNS.join(',');

/** One CSV line per transaction, no header — lets the server stream a long export in chunks. */
export const transactionsToCsvRows = (transactions: Transaction[]): string[] =>
  transactions.map((t) => CSV_COLUMNS.map((col) => csvEscape(t[col] as string | number | null)).join(','));

/** Header + one row per transaction, in the given order (caller sorts beforehand). */
export const transactionsToCsv = (transactions: Transaction[]): string => [CSV_HEADER, ...transactionsToCsvRows(transactions)].join('\n');
