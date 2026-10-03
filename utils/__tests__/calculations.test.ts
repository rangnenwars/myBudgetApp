import {
  classifyLocal,
  computeMonthSummary,
  computeCategoryBreakdown,
  computeSavingsRate,
  generateMonthRange,
  computeMonthlySeries,
  formatMonthLabel,
  computeCategoryDeltas,
  computeNetWorth,
  computeDebtOrder,
  simulateDebtPayoff,
  computePartPayment,
  computeGoalETA,
  transactionsToCsv,
  bucketForGroup,
  monthlyEquivalent,
  splitEmi,
  monthsToRepay,
} from '../calculations';
import { Transaction, Loan, Investment, SavingsGoal } from '../types';

// ---------- test fixtures ----------

let txnId = 0;
const txn = (overrides: Partial<Transaction>): Transaction => ({
  id: ++txnId,
  amount: 100,
  type: 'expense',
  category: 'groceries_milk',
  subcategory: null,
  note: null,
  date: '2026-06-15',
  month: 6,
  year: 2026,
  created_at: '2026-06-15T00:00:00.000Z',
  ...overrides,
});

let loanId = 0;
const loan = (overrides: Partial<Loan>): Loan => ({
  id: ++loanId,
  name: 'Test loan',
  principal: 100_000,
  outstanding: 50_000,
  emi: 5_000,
  interest_rate: null,
  tenure_months: null,
  start_date: null,
  loan_type: null,
  lender: null,
  note: null,
  is_active: true,
  counts_as_expense: true,
  ...overrides,
});

let invId = 0;
const investment = (overrides: Partial<Investment>): Investment => ({
  id: ++invId,
  name: 'Test investment',
  type: 'Mutual fund',
  amount: 10_000,
  current_value: 12_000,
  start_date: null,
  maturity_date: null,
  returns_percent: 20,
  note: null,
  ...overrides,
});

let goalId = 0;
const goal = (overrides: Partial<SavingsGoal>): SavingsGoal => ({
  id: ++goalId,
  name: 'Test goal',
  target_amount: 10_000,
  saved_amount: 2_000,
  deadline: null,
  color: '#10B981',
  icon: 'star',
  note: null,
  ...overrides,
});

// ---------- classifyLocal ----------

describe('classifyLocal', () => {
  it('classifies below 30k as low', () => {
    expect(classifyLocal(0)).toBe('low');
    expect(classifyLocal(29_999)).toBe('low');
  });
  it('classifies negative outflow as low (no negative-spend edge case exists in practice)', () => {
    expect(classifyLocal(-500)).toBe('low');
  });
  it('classifies boundary values into the upper bracket', () => {
    expect(classifyLocal(30_000)).toBe('middle');
    expect(classifyLocal(100_000)).toBe('high');
    expect(classifyLocal(300_000)).toBe('ultra_high');
    expect(classifyLocal(1_000_000)).toBe('rich');
  });
  it('classifies just under each boundary into the lower bracket', () => {
    expect(classifyLocal(99_999)).toBe('middle');
    expect(classifyLocal(299_999)).toBe('high');
    expect(classifyLocal(999_999)).toBe('ultra_high');
  });
});

// ---------- computeMonthSummary ----------

describe('computeMonthSummary', () => {
  it('returns zeros for no transactions', () => {
    expect(computeMonthSummary([])).toEqual({ totalIncome: 0, totalExpense: 0, netSavings: 0 });
  });
  it('sums income and expense separately', () => {
    const txns = [
      txn({ type: 'income', amount: 50_000 }),
      txn({ type: 'expense', amount: 10_000 }),
      txn({ type: 'expense', amount: 5_000 }),
    ];
    expect(computeMonthSummary(txns)).toEqual({ totalIncome: 50_000, totalExpense: 15_000, netSavings: 35_000 });
  });
  it('produces negative net savings when expenses exceed income', () => {
    const txns = [txn({ type: 'income', amount: 1_000 }), txn({ type: 'expense', amount: 3_000 })];
    expect(computeMonthSummary(txns).netSavings).toBe(-2_000);
  });
});

// ---------- computeCategoryBreakdown ----------

describe('computeCategoryBreakdown', () => {
  it('returns empty for no matching transactions', () => {
    expect(computeCategoryBreakdown([], 'expense')).toEqual([]);
  });
  it('groups by category and sums, ignoring the other type', () => {
    const txns = [
      txn({ type: 'expense', category: 'groceries_milk', amount: 500 }),
      txn({ type: 'expense', category: 'groceries_milk', amount: 300 }),
      txn({ type: 'expense', category: 'fuel_petrol', amount: 1_000 }),
      txn({ type: 'income', category: 'salary_1', amount: 50_000 }),
    ];
    expect(computeCategoryBreakdown(txns, 'expense')).toEqual([
      { category: 'fuel_petrol', total: 1_000 },
      { category: 'groceries_milk', total: 800 },
    ]);
  });
  it('sorts descending by total', () => {
    const txns = [
      txn({ category: 'a', amount: 10 }),
      txn({ category: 'b', amount: 999 }),
      txn({ category: 'c', amount: 500 }),
    ];
    const result = computeCategoryBreakdown(txns, 'expense');
    expect(result.map((r) => r.category)).toEqual(['b', 'c', 'a']);
  });
});

// ---------- computeSavingsRate ----------

describe('computeSavingsRate', () => {
  it('returns 0 when income is 0', () => {
    expect(computeSavingsRate({ totalIncome: 0, totalExpense: 500, netSavings: -500 })).toBe(0);
  });
  it('computes percentage correctly', () => {
    expect(computeSavingsRate({ totalIncome: 1_000, totalExpense: 700, netSavings: 300 })).toBe(30);
  });
  it('returns a negative rate when spending exceeds income', () => {
    expect(computeSavingsRate({ totalIncome: 1_000, totalExpense: 1_500, netSavings: -500 })).toBe(-50);
  });
});

// ---------- generateMonthRange ----------

describe('generateMonthRange', () => {
  it('returns a single point for the same start/end month', () => {
    expect(generateMonthRange(6, 2026, 6, 2026)).toEqual([{ month: 6, year: 2026 }]);
  });
  it('wraps across a year boundary', () => {
    expect(generateMonthRange(11, 2025, 2, 2026)).toEqual([
      { month: 11, year: 2025 },
      { month: 12, year: 2025 },
      { month: 1, year: 2026 },
      { month: 2, year: 2026 },
    ]);
  });
  it('returns an empty array for a reversed range', () => {
    expect(generateMonthRange(6, 2026, 1, 2026)).toEqual([]);
  });
});

// ---------- computeMonthlySeries ----------

describe('computeMonthlySeries', () => {
  it('fills in zeros for months with no transactions', () => {
    const range = generateMonthRange(1, 2026, 3, 2026);
    const txns = [txn({ month: 2, year: 2026, type: 'income', amount: 1_000 })];
    const series = computeMonthlySeries(txns, range);
    expect(series).toEqual([
      { month: 1, year: 2026, label: 'Jan 2026', income: 0, expense: 0, net: 0 },
      { month: 2, year: 2026, label: 'Feb 2026', income: 1_000, expense: 0, net: 1_000 },
      { month: 3, year: 2026, label: 'Mar 2026', income: 0, expense: 0, net: 0 },
    ]);
  });
});

describe('formatMonthLabel', () => {
  it('formats the first and last month correctly', () => {
    expect(formatMonthLabel(1, 2026)).toBe('Jan 2026');
    expect(formatMonthLabel(12, 2026)).toBe('Dec 2026');
  });
});

// ---------- computeCategoryDeltas ----------

describe('computeCategoryDeltas', () => {
  it('marks a brand-new category with a null deltaPct', () => {
    const current = [txn({ category: 'shopping', amount: 500 })];
    const result = computeCategoryDeltas(current, [], 'expense');
    expect(result).toEqual([{ category: 'shopping', current: 500, previous: 0, deltaAmount: 500, deltaPct: null }]);
  });
  it('computes percentage increase against a previous baseline', () => {
    const current = [txn({ category: 'shopping', amount: 150 })];
    const previous = [txn({ category: 'shopping', amount: 100 })];
    const [result] = computeCategoryDeltas(current, previous, 'expense');
    expect(result.deltaPct).toBe(50);
  });
  it('handles a category dropping to zero this period', () => {
    const previous = [txn({ category: 'shopping', amount: 200 })];
    const [result] = computeCategoryDeltas([], previous, 'expense');
    expect(result).toEqual({ category: 'shopping', current: 0, previous: 200, deltaAmount: -200, deltaPct: -100 });
  });
  it('sorts by absolute delta amount, descending', () => {
    const current = [txn({ category: 'small', amount: 20 }), txn({ category: 'big', amount: 1_000 })];
    const result = computeCategoryDeltas(current, [], 'expense');
    expect(result.map((r) => r.category)).toEqual(['big', 'small']);
  });
});

// ---------- computeNetWorth ----------

describe('computeNetWorth', () => {
  it('is zero with no data', () => {
    expect(computeNetWorth([], [], [])).toBe(0);
  });
  it('adds investment current value, goal savings, and subtracts loan outstanding', () => {
    const investments = [investment({ current_value: 20_000 })];
    const goals = [goal({ saved_amount: 5_000 })];
    const loans = [loan({ outstanding: 8_000 })];
    expect(computeNetWorth(investments, goals, loans)).toBe(20_000 + 5_000 - 8_000);
  });
  it('falls back to invested amount when current_value is null', () => {
    const investments = [investment({ current_value: null, amount: 7_500 })];
    expect(computeNetWorth(investments, [], [])).toBe(7_500);
  });
});

// ---------- computeDebtOrder ----------

describe('computeDebtOrder', () => {
  it('orders snowball by smallest outstanding balance first', () => {
    const loans = [loan({ outstanding: 50_000 }), loan({ outstanding: 5_000 }), loan({ outstanding: 20_000 })];
    const order = computeDebtOrder(loans, 'snowball');
    expect(order.map((l) => l.outstanding)).toEqual([5_000, 20_000, 50_000]);
  });
  it('orders avalanche by highest interest rate first', () => {
    const loans = [loan({ interest_rate: 8 }), loan({ interest_rate: 14 }), loan({ interest_rate: null })];
    const order = computeDebtOrder(loans, 'avalanche');
    expect(order.map((l) => l.interest_rate)).toEqual([14, 8, null]);
  });
  it('excludes loans that are already paid off', () => {
    const loans = [loan({ outstanding: 0 }), loan({ outstanding: 1_000 })];
    expect(computeDebtOrder(loans, 'snowball')).toHaveLength(1);
  });
});

// ---------- simulateDebtPayoff ----------

describe('simulateDebtPayoff', () => {
  it('returns [] for no loans', () => {
    expect(simulateDebtPayoff([], 'snowball')).toEqual([]);
  });

  it('pays off a single loan in the expected number of months', () => {
    const loans = [loan({ outstanding: 1_000, emi: 100 })];
    const [result] = simulateDebtPayoff(loans, 'snowball', 0, new Date(2026, 0, 1));
    expect(result.payoffMonths).toBe(10);
    expect(result.payoffDate).toBe('2026-11'); // paid off at the start of the 10th month out from Jan
  });

  it('snowballs the freed-up EMI into the next loan, finishing it faster than its own EMI alone would', () => {
    // Loan A: small, clears in 2 months. Loan B: would take 100 months on its own EMI.
    const loans = [
      loan({ id: 1, name: 'A', outstanding: 200, emi: 100 }),
      loan({ id: 2, name: 'B', outstanding: 10_000, emi: 100 }),
    ];
    const results = simulateDebtPayoff(loans, 'snowball');
    const a = results.find((r) => r.name === 'A')!;
    const b = results.find((r) => r.name === 'B')!;
    expect(a.payoffMonths).toBe(2);
    // Without snowballing, B alone would take 100 months. With A's freed EMI rolled in from month 3, it must finish sooner.
    expect(b.payoffMonths).toBeLessThan(100);
  });

  it('avalanche prioritizes the higher interest-rate loan for extra payments', () => {
    const loans = [
      loan({ id: 1, name: 'LowRate', outstanding: 5_000, emi: 100, interest_rate: 5 }),
      loan({ id: 2, name: 'HighRate', outstanding: 5_000, emi: 100, interest_rate: 20 }),
    ];
    const extra = 400;
    const results = simulateDebtPayoff(loans, 'avalanche', extra);
    const highRate = results.find((r) => r.name === 'HighRate')!;
    const lowRate = results.find((r) => r.name === 'LowRate')!;
    expect(highRate.payoffMonths).toBeLessThan(lowRate.payoffMonths);
  });

  it('finishes faster with a larger extra monthly payment', () => {
    const loans = [loan({ outstanding: 10_000, emi: 500 })];
    const [withoutExtra] = simulateDebtPayoff(loans, 'snowball', 0);
    const [withExtra] = simulateDebtPayoff([loan({ outstanding: 10_000, emi: 500 })], 'snowball', 1_000);
    expect(withExtra.payoffMonths).toBeLessThan(withoutExtra.payoffMonths);
  });

  it('does not include a loan whose EMI can never outpace its balance (safety cap reached)', () => {
    const loans = [loan({ outstanding: 1_000_000, emi: 1 })];
    const results = simulateDebtPayoff(loans, 'snowball');
    expect(results).toEqual([]);
  });
});

// ---------- computeGoalETA ----------

describe('computePartPayment', () => {
  it('lowers the balance and scales the EMI by the same ratio', () => {
    const result = computePartPayment({ outstanding: 100_000, emi: 10_000 }, 25_000);
    expect(result).toEqual({ outstanding: 75_000, emi: 7_500, monthsLeft: 10 });
  });

  it('keeps the remaining number of instalments unchanged', () => {
    const before = Math.ceil(240_000 / 12_000);
    const after = computePartPayment({ outstanding: 240_000, emi: 12_000 }, 60_000);
    expect(after.monthsLeft).toBe(before);
  });

  it('rounds to paise so repeated payments do not drift', () => {
    const result = computePartPayment({ outstanding: 100_000, emi: 3_333 }, 1);
    expect(result.outstanding).toBe(99_999);
    expect(result.emi).toBe(3_332.97);
  });

  it('leaves the EMI untouched and reports no months left when the payment clears the loan', () => {
    expect(computePartPayment({ outstanding: 5_000, emi: 1_000 }, 5_000)).toEqual({ outstanding: 0, emi: 1_000, monthsLeft: null });
  });

  it('never lets the EMI fall to zero', () => {
    const result = computePartPayment({ outstanding: 1_000_000, emi: 1 }, 999_999);
    expect(result.outstanding).toBe(1);
    expect(result.emi).toBe(0.01);
  });
});

describe('computeGoalETA', () => {
  it('reports already-reached goals as 0 months', () => {
    const g = goal({ target_amount: 1_000, saved_amount: 1_500 });
    const result = computeGoalETA(g, 100, new Date(2026, 0, 1));
    expect(result.monthsRemaining).toBe(0);
  });
  it('returns nulls when average savings is zero or negative', () => {
    const g = goal({ target_amount: 10_000, saved_amount: 2_000 });
    expect(computeGoalETA(g, 0)).toEqual({ monthsRemaining: null, etaDate: null });
    expect(computeGoalETA(g, -100)).toEqual({ monthsRemaining: null, etaDate: null });
  });
  it('rounds up to the next whole month and computes the ETA date', () => {
    const g = goal({ target_amount: 10_000, saved_amount: 0 });
    const result = computeGoalETA(g, 3_000, new Date(2026, 0, 1)); // needs 3.33 months
    expect(result.monthsRemaining).toBe(4);
    expect(result.etaDate).toBe('2026-05');
  });
});

// ---------- transactionsToCsv ----------

describe('transactionsToCsv', () => {
  it('produces just the header for an empty list', () => {
    expect(transactionsToCsv([])).toBe('date,type,category,amount,note');
  });
  it('writes one row per transaction in the declared column order', () => {
    const csv = transactionsToCsv([txn({ date: '2026-06-01', type: 'expense', category: 'fuel_petrol', amount: 1_500, note: null })]);
    expect(csv).toBe('date,type,category,amount,note\n2026-06-01,expense,fuel_petrol,1500,');
  });
  it('quotes and escapes fields containing commas or quotes', () => {
    const csv = transactionsToCsv([txn({ note: 'lunch, with "friends"' })]);
    expect(csv).toContain('"lunch, with ""friends"""');
  });
});

// ---------- bucketForGroup ----------

describe('bucketForGroup', () => {
  it('classifies loan-related groups as loan', () => {
    expect(bucketForGroup('Loans & EMIs')).toBe('loan');
    expect(bucketForGroup('Credit cards')).toBe('loan');
  });
  it('classifies the investments group as investment', () => {
    expect(bucketForGroup('Investments & savings')).toBe('investment');
  });
  it('falls back to expense for everything else', () => {
    expect(bucketForGroup('Food & dining')).toBe('expense');
    expect(bucketForGroup('Household')).toBe('expense');
    expect(bucketForGroup('Some unknown group')).toBe('expense');
  });
});

// ---------- monthlyEquivalent ----------

describe('monthlyEquivalent', () => {
  it('passes monthly amounts through unchanged', () => {
    expect(monthlyEquivalent(1_000, 'monthly')).toBe(1_000);
  });
  it('divides quarterly amounts by 3', () => {
    expect(monthlyEquivalent(3_000, 'quarterly')).toBe(1_000);
  });
  it('divides yearly amounts by 12', () => {
    expect(monthlyEquivalent(12_000, 'yearly')).toBe(1_000);
  });
  it('handles zero', () => {
    expect(monthlyEquivalent(0, 'yearly')).toBe(0);
  });
});

describe('splitEmi', () => {
  it('splits an EMI into a month of interest at rate/12 and the rest as principal', () => {
    expect(splitEmi(100000, 12, 10000)).toEqual({ payment: 10000, interest: 1000, principal: 9000, outstanding: 91000 });
  });
  it('treats a missing rate as interest-free', () => {
    expect(splitEmi(50000, null, 5000)).toEqual({ payment: 5000, interest: 0, principal: 5000, outstanding: 45000 });
  });
  it('caps the final instalment at the balance plus interest', () => {
    expect(splitEmi(5000, 12, 10000)).toEqual({ payment: 5050, interest: 50, principal: 5000, outstanding: 0 });
  });
  it('repays no principal (and holds the balance) when the EMI only covers interest', () => {
    expect(splitEmi(100000, 24, 1500)).toEqual({ payment: 1500, interest: 1500, principal: 0, outstanding: 100000 });
  });
  it('is all zeros for a paid-off loan', () => {
    expect(splitEmi(0, 10, 1000)).toEqual({ payment: 0, interest: 0, principal: 0, outstanding: 0 });
  });
});

describe('monthsToRepay', () => {
  it('is balance / EMI rounded up without interest', () => {
    expect(monthsToRepay(10000, null, 3000)).toBe(4);
  });
  it('takes longer with interest', () => {
    // ₹1,00,000 at 12% with a ₹10,000 EMI takes 11 instalments, not 10.
    expect(monthsToRepay(100000, 12, 10000)).toBe(11);
  });
  it('is null when the EMI never covers the interest', () => {
    expect(monthsToRepay(100000, 24, 1500)).toBeNull();
  });
  it('is 0 for a paid-off loan', () => {
    expect(monthsToRepay(0, 10, 1000)).toBe(0);
  });
});

describe('computeNetWorth with accounts', () => {
  it('adds bank/cash/wallet balances and subtracts credit-card dues', () => {
    const accounts = [
      { type: 'bank' as const, balance: 10000 },
      { type: 'cash' as const, balance: 500 },
      { type: 'credit_card' as const, balance: 3000 },
    ];
    expect(computeNetWorth([], [], [], accounts)).toBe(7500);
  });
});

describe('simulateDebtPayoff with interest and rollover', () => {
  it('counts interest, so a loan at a rate takes longer than balance ÷ EMI', () => {
    const [noRate] = simulateDebtPayoff([loan({ outstanding: 100000, emi: 10000, interest_rate: null })], 'snowball');
    const [withRate] = simulateDebtPayoff([loan({ outstanding: 100000, emi: 10000, interest_rate: 12 })], 'snowball');
    expect(noRate.payoffMonths).toBe(10);
    expect(withRate.payoffMonths).toBe(11); // same as monthsToRepay
  });

  it('rolls an overpayment on to the next loan in the same month', () => {
    // Extra 1,000 clears A (500) in month 1; the 500 left over plus B's EMI clears B (600) in month 1 too.
    const results = simulateDebtPayoff(
      [loan({ id: 1, name: 'A', outstanding: 500, emi: 100 }), loan({ id: 2, name: 'B', outstanding: 600, emi: 100 })],
      'snowball',
      1000
    );
    expect(results.map((r) => [r.name, r.payoffMonths])).toEqual([
      ['A', 1],
      ['B', 1],
    ]);
  });

  it('leaves out a loan whose EMI never covers its interest', () => {
    expect(simulateDebtPayoff([loan({ outstanding: 100000, emi: 1000, interest_rate: 24 })], 'snowball')).toEqual([]);
  });
});
