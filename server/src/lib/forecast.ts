import { and, asc, eq, gt, gte, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, loans, recurringTransactions, transactions } from '../db/schema';
import { addMonths, localToday, LocalDate } from './clock';
import { hasFeature } from './features';
import { monthlyIncome } from './freeMoneyDay';
import { FREQUENCY_MONTHS, RepeatFrequency, nextDueAfter, postingDate } from './recurringTransactions';
import { monthStart } from './loanEmiExpenses';
import { splitEmi } from '../calculations';

// Plan ahead: the next 12 months worked out from what the user already told
// the app — repeating income and bills, loan EMIs — plus a "typical spending"
// estimate from the last three full months. Read-only: nothing is posted and
// no future transactions exist. See docs/ROADMAP.md (Plan ahead).

export const FORECAST_MONTHS = 12;
export const TYPICAL_MONTHS = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
// A rule's next_due can sit years back only if posting is broken; this stops a bad row looping.
const MAX_STEPS = 600;

export interface ForecastItem {
  kind: 'income' | 'bill' | 'loan';
  /** The repeating rule (income, bill) or loan this line comes from, so the app can open it; absent for the estimated average income. */
  id?: number;
  label: string;
  amount: number;
  /** YYYY-MM-DD, or null for an estimated average income. */
  date: string | null;
  frequency?: RepeatFrequency;
}

export interface ForecastMonth {
  year: number;
  month: number;
  income: number;
  fixed: number;
  /** income − fixed bills (and EMIs): what is certain from the repeating entries. */
  known: number;
  /** known − typical spending; equals `known` when there is no typical estimate. */
  likely: number;
  items: ForecastItem[];
}

export interface Forecast {
  /** 'likely' once there is enough history to estimate typical spending, otherwise 'known'. */
  basis: 'likely' | 'known';
  incomeSource: 'repeating' | 'average' | 'none';
  typical: {
    available: boolean;
    monthsUsed: number;
    perMonth: number;
    categories: { category: string; label: string; amount: number }[];
  };
  months: ForecastMonth[];
  summary: { tightest: { year: number; month: number; left: number } | null; averageLeft: number };
}

interface Rule {
  id?: number;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  note: string | null;
  label: string;
  frequency: RepeatFrequency;
  day_of_month: number;
  next_due: string;
  posted_through: string;
  ends_on: string | null;
}

interface LoanRow {
  id?: number;
  name: string;
  outstanding: number;
  emi: number;
  interest_rate: number | null;
  counts_as_expense: boolean;
  emi_expensed_through: string | null;
}

interface SpendRow {
  category: string;
  amount: number;
  date: string;
}

/** Dates a rule posts on within [from, to] (YYYY-MM-DD, inclusive), starting from its next due date and honouring its end date. */
export const ruleDatesBetween = (rule: Pick<Rule, 'frequency' | 'day_of_month' | 'next_due' | 'ends_on'>, from: string, to: string): string[] => {
  const dates: string[] = [];
  let date = rule.next_due;
  for (let i = 0; i < MAX_STEPS && date <= to; i++) {
    if (rule.ends_on && date > rule.ends_on) break;
    if (date >= from) dates.push(date);
    date = nextDueAfter(`${date.slice(0, 7)}-01`, rule.frequency, rule.day_of_month);
  }
  return dates;
};

/**
 * Dates a rule has already posted on within [from, to], found by stepping back
 * from posted_through. Used to keep rule-posted bills out of "typical spending".
 */
const postedDatesBetween = (rule: Pick<Rule, 'frequency' | 'day_of_month' | 'posted_through'>, from: string, to: string): string[] => {
  const step = FREQUENCY_MONTHS[rule.frequency];
  const [y, m] = rule.posted_through.split('-').map(Number);
  const dates: string[] = [];
  for (let k = 0; k < MAX_STEPS; k++) {
    const period = addMonths(y, m, -k * step);
    const date = postingDate(period.year, period.month, rule.day_of_month);
    if (date < from) break;
    if (date <= to) dates.push(date);
  }
  return dates;
};

/**
 * Average monthly spending per category over the last three full months,
 * leaving out what the app posted by itself: loan EMIs, and entries on the day
 * a repeating rule posts in the same category (matched by category and date,
 * so an amount edited later still matches). Those are already shown as fixed
 * bills — counting them again would double them.
 */
export const estimateTypicalSpending = (
  rows: SpendRow[],
  rules: Pick<Rule, 'type' | 'category' | 'frequency' | 'day_of_month' | 'posted_through'>[],
  window: { from: string; to: string },
  monthsUsed: number
): { category: string; amount: number }[] => {
  if (monthsUsed <= 0) return [];
  const autoPosted = new Map<string, number>();
  for (const rule of rules.filter((r) => r.type === 'expense')) {
    for (const date of postedDatesBetween(rule, window.from, window.to)) {
      const key = `${rule.category}|${date}`;
      autoPosted.set(key, (autoPosted.get(key) ?? 0) + 1);
    }
  }
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.category === 'loan_emi') continue;
    const key = `${row.category}|${row.date}`;
    const left = autoPosted.get(key) ?? 0;
    if (left > 0) {
      autoPosted.set(key, left - 1);
      continue;
    }
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amount);
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, amount: Math.round(total / monthsUsed) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
};

/** Each month's EMI for a loan, reducing the balance the same way posting does (splitEmi). */
const loanPayments = (loan: LoanRow, months: { year: number; month: number }[], current: { year: number; month: number }) => {
  let outstanding = loan.outstanding;
  // This month's EMI may not be posted yet (it posts on the next read). Once posted
  // it pays the loan down; a loan's very first posting is an expense only.
  const currentStart = monthStart(current.year, current.month);
  if (loan.counts_as_expense && loan.emi_expensed_through && loan.emi_expensed_through < currentStart) {
    outstanding = splitEmi(outstanding, loan.interest_rate, loan.emi).outstanding;
  }
  return months.map(() => {
    if (outstanding <= 0) return 0;
    const split = splitEmi(outstanding, loan.interest_rate, loan.emi);
    outstanding = split.outstanding;
    return split.payment;
  });
};

export interface ForecastInput {
  today: LocalDate;
  rules: Rule[];
  loans: LoanRow[];
  /** With Loans switched off, EMIs are still counted but unnamed (as in the free money day). */
  loansOn: boolean;
  spendRows: SpendRow[];
  /** Month index (year*12 + month−1) of the user's very first transaction, if any. */
  firstEntryIndex: number | null;
  labels: Map<string, string>;
  averageIncome: { amount: number } | null;
}

/** The calculation itself, free of database access so it can be tested with plain data. */
export const buildForecast = (input: ForecastInput): Forecast => {
  const { today, rules, loansOn } = input;
  const first = addMonths(today.year, today.month, 1);
  const months = Array.from({ length: FORECAST_MONTHS }, (_, i) => addMonths(first.year, first.month, i));
  const horizonFrom = monthStart(first.year, first.month);
  const last = months[months.length - 1];
  const horizonTo = `${last.year}-${pad(last.month)}-31`;

  // Typical spending window: the last three full months, minus the month of the
  // user's first entry (they started part-way through it).
  const windowEnd = addMonths(today.year, today.month, -1);
  const endIndex = windowEnd.year * 12 + windowEnd.month - 1;
  let startIndex = endIndex - (TYPICAL_MONTHS - 1);
  if (input.firstEntryIndex != null && input.firstEntryIndex >= startIndex) startIndex = input.firstEntryIndex + 1;
  const monthsUsed = input.firstEntryIndex == null ? 0 : Math.max(0, endIndex - startIndex + 1);
  const startMonth = addMonths(0, 1, startIndex);
  const window = { from: monthStart(startMonth.year, startMonth.month), to: `${windowEnd.year}-${pad(windowEnd.month)}-31` };
  const typicalCategories = estimateTypicalSpending(
    input.spendRows.filter((r) => r.date >= window.from && r.date <= window.to),
    rules,
    window,
    monthsUsed
  ).map((c) => ({ ...c, label: input.labels.get(c.category) ?? c.category }));
  const typicalPerMonth = typicalCategories.reduce((s, c) => s + c.amount, 0);
  const typicalAvailable = monthsUsed > 0;

  const result: ForecastMonth[] = months.map((m) => ({ ...m, income: 0, fixed: 0, known: 0, likely: 0, items: [] }));
  const slot = (date: string) => result.find((r) => r.year === Number(date.slice(0, 4)) && r.month === Number(date.slice(5, 7)))!;

  for (const rule of rules) {
    const label = rule.note?.trim() || rule.label;
    for (const date of ruleDatesBetween(rule, horizonFrom, horizonTo)) {
      const month = slot(date);
      month.items.push({ kind: rule.type === 'income' ? 'income' : 'bill', id: rule.id, label, amount: rule.amount, date, frequency: rule.frequency });
    }
  }

  // An income rule that has already ended projects nothing, so it doesn't count as one.
  const hasIncomeRule = result.some((m) => m.items.some((i) => i.kind === 'income'));
  let incomeSource: Forecast['incomeSource'] = hasIncomeRule ? 'repeating' : 'none';
  if (!hasIncomeRule && input.averageIncome && input.averageIncome.amount > 0) {
    incomeSource = 'average';
    for (const month of result) {
      month.items.push({ kind: 'income', label: 'Average income (last 3 months)', amount: round2(input.averageIncome.amount), date: null });
    }
  }

  const current = { year: today.year, month: today.month };
  for (const loan of input.loans) {
    if (!loansOn && !loan.counts_as_expense) continue;
    loanPayments(loan, months, current).forEach((amount, i) => {
      if (amount > 0) result[i].items.push({ kind: 'loan', id: loan.id, label: loansOn ? loan.name : 'Loan EMI', amount, date: monthStart(months[i].year, months[i].month) });
    });
  }

  for (const month of result) {
    month.items.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || b.amount - a.amount);
    month.income = round2(month.items.filter((i) => i.kind === 'income').reduce((s, i) => s + i.amount, 0));
    month.fixed = round2(month.items.filter((i) => i.kind !== 'income').reduce((s, i) => s + i.amount, 0));
    month.known = round2(month.income - month.fixed);
    month.likely = round2(month.known - (typicalAvailable ? typicalPerMonth : 0));
  }

  const basis: Forecast['basis'] = typicalAvailable ? 'likely' : 'known';
  const left = (m: ForecastMonth) => (basis === 'likely' ? m.likely : m.known);
  const tightestMonth = result.reduce((a, b) => (left(b) < left(a) ? b : a), result[0]);

  return {
    basis,
    incomeSource,
    typical: { available: typicalAvailable, monthsUsed, perMonth: typicalPerMonth, categories: typicalCategories },
    months: result,
    summary: {
      tightest: { year: tightestMonth.year, month: tightestMonth.month, left: left(tightestMonth) },
      averageLeft: round2(result.reduce((s, m) => s + left(m), 0) / result.length),
    },
  };
};

export const getForecast = async (userId: number, now: Date = new Date()): Promise<Forecast> => {
  const today = localToday(now);
  const windowStart = addMonths(today.year, today.month, -TYPICAL_MONTHS);
  const thisMonthStart = monthStart(today.year, today.month);

  const ruleRows = await db
    .select({ rule: recurringTransactions, label: categories.label })
    .from(recurringTransactions)
    .innerJoin(categories, eq(categories.key, recurringTransactions.category))
    .where(eq(recurringTransactions.userId, userId));
  const rules: Rule[] = ruleRows.map(({ rule, label }) => ({
    id: rule.id,
    type: rule.type,
    category: rule.category,
    amount: rule.amount,
    note: rule.note,
    label,
    frequency: rule.frequency as RepeatFrequency,
    day_of_month: rule.day_of_month,
    next_due: rule.next_due,
    posted_through: rule.posted_through,
    ends_on: rule.ends_on,
  }));

  const loanRows = await db
    .select()
    .from(loans)
    .where(and(eq(loans.userId, userId), eq(loans.is_active, true), gt(loans.outstanding, 0)));

  const spendRows = await db
    .select({ category: transactions.category, amount: transactions.amount, date: transactions.date })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.type, 'expense'), gte(transactions.date, monthStart(windowStart.year, windowStart.month)), lt(transactions.date, thisMonthStart)));

  const [firstEntry] = await db
    .select({ year: transactions.year, month: transactions.month })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.date))
    .limit(1);

  const labelRows = await db.select({ key: categories.key, label: categories.label }).from(categories);

  const activeIncomeRule = rules.some((r) => r.type === 'income' && ruleDatesBetween(r, thisMonthStart, '9999-12-31').length > 0);
  const averageIncome = activeIncomeRule ? null : await monthlyIncome(userId, 0, today);

  return buildForecast({
    today,
    // Expired rules stay in the list for matching past postings; they project nothing.
    rules,
    loans: loanRows.map((l) => ({
      id: l.id,
      name: l.name,
      outstanding: l.outstanding,
      emi: l.emi,
      interest_rate: l.interest_rate,
      counts_as_expense: l.counts_as_expense,
      emi_expensed_through: l.emi_expensed_through,
    })),
    loansOn: await hasFeature(userId, 'loans'),
    spendRows,
    firstEntryIndex: firstEntry ? firstEntry.year * 12 + firstEntry.month - 1 : null,
    labels: new Map(labelRows.map((l) => [l.key, l.label])),
    averageIncome,
  });
};
