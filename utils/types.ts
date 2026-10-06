export type TxnType = 'income' | 'expense';

export interface Transaction {
  id: number;
  amount: number;
  type: TxnType;
  category: string;
  subcategory?: string | null;
  note?: string | null;
  date: string;
  month: number;
  year: number;
  /** Shared by the entries saved together from one split payment; null/absent otherwise. */
  splitGroup?: string | null;
  created_at: string;
}

/** A repeating rule: posts the same entry every month/quarter/year on day_of_month, after the original one. */
export interface RecurringTransaction {
  id: number;
  type: TxnType;
  category: string;
  amount: number;
  note: string | null;
  posted_through: string;
  frequency: RepeatFrequency;
  day_of_month: number;
  /** YYYY-MM-DD the next entry is added on. */
  next_due: string;
}

export interface Loan {
  id: number;
  name: string;
  principal: number;
  outstanding: number;
  emi: number;
  interest_rate: number | null;
  tenure_months: number | null;
  start_date: string | null;
  loan_type: string | null;
  lender: string | null;
  note: string | null;
  // boolean, not SQLite's 0/1 integer convention — Postgres has a real
  // boolean type now that a server exists; nothing reads this field beyond
  // the storage layer's own "active" filter, so widening it is safe.
  is_active: boolean;
  // false = EMI payments don't become expense transactions, but the
  // outstanding balance still counts as a liability (Reports net worth).
  counts_as_expense: boolean;
}

export interface Investment {
  id: number;
  name: string;
  type: string;
  amount: number;
  current_value: number | null;
  start_date: string | null;
  maturity_date: string | null;
  returns_percent: number | null;
  note: string | null;
}

export type AccountType = 'bank' | 'cash' | 'wallet' | 'credit_card';

/** Where money sits. Balance is typed in by the user; for a credit card it is the amount owed. */
export interface Account {
  id: number;
  name: string;
  type: AccountType;
  balance: number;
  updated_at: string;
}

export type RepeatFrequency = 'monthly' | 'quarterly' | 'yearly';

/** A category's monthly spending limit with what has been spent against it in the requested month. */
/** The one overall monthly budget and this month's progress against it. Progress fields are null when no budget is set. */
export interface OverallBudget {
  month: number;
  year: number;
  amount: number | null;
  /** Whether EMIs, credit-card bills and investments count toward it (off by default). */
  include_commitments: boolean;
  spent: number;
  /** Sum of the optional category limits. */
  allocated: number;
  /** Average counted spending over the last 3 full months, rounded to ₹100; null without history. */
  suggested: number | null;
  left: number | null;
  ratio: number | null;
  status: 'ok' | 'warning' | 'over' | null;
  days_left: number | null;
  per_day: number | null;
}

export interface BudgetStatus {
  category: string;
  monthly_limit: number;
  spent: number;
  /** spent / monthly_limit, e.g. 0.85 = 85% used. */
  ratio: number;
  /** ok < 80% ≤ warning < 100% ≤ over */
  status: 'ok' | 'warning' | 'over';
}

export interface SavingsGoal {
  id: number;
  name: string;
  target_amount: number;
  saved_amount: number;
  deadline: string | null;
  color: string;
  icon: string;
  note: string | null;
}

export interface GoalContribution {
  id: number;
  amount: number;
  type: 'add' | 'remove';
  created_at: string;
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  tier: string;
  budget_class: string | null;
  created_at: string;
}

export interface MonthSummary {
  totalIncome: number;
  totalExpense: number;
  netSavings: number;
}

export interface CategoryTotal {
  category: string;
  total: number;
}

/** What the Home card and the free-money-day screen show; computed by GET /reports/free-money-day. */
export interface FreeMoneyDayInfo {
  year: number;
  month: number;
  daysInMonth: number;
  income: number;
  incomeSource: 'repeating' | 'average' | 'this_month';
  committed: number;
  items: { kind: 'loan' | 'repeating'; label: string; amount: number }[];
  share: number;
  day: number | null;
  daysFree: number;
  status: 'ok' | 'over' | 'no_income';
  /** YYYY-MM-DD of the free-money day, null when there is none to show. */
  freeDate: string | null;
  /** Last week's reading laid over this month; null on the first week. */
  previous: { weekStart: string; day: number } | null;
  /** Days earlier than last week (negative = later); null without a previous reading. */
  daysEarlier: number | null;
  /** Active loans, for the "what if I prepay" preview. */
  loans: { id: number; name: string; emi: number; outstanding: number; interest_rate: number | null }[];
}

export type LedgerKind = 'lent' | 'borrowed' | 'received' | 'repaid' | 'written_off' | 'split_share';

/** Someone the user lends to, borrows from or shares bills with. `balance` > 0: they owe the user; < 0: the user owes them. */
export interface Person {
  id: number;
  name: string;
  balance: number;
  /** YYYY-MM-DD "pay back by" for what is outstanding, or null. */
  dueDate: string | null;
  overdue: boolean;
  lastActivity: string | null;
}

export interface PeopleSummary {
  youGet: number;
  youOwe: number;
  people: Person[];
}

/** One line of a person's ledger; `amount` is signed like the balance. */
export interface LedgerEntry {
  id: number;
  kind: LedgerKind;
  amount: number;
  date: string;
  note: string | null;
}
