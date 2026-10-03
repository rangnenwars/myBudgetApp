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
  created_at: string;
}

/** A "repeat every month" rule: posts the same entry on the 1st of each month after the original one. */
export interface RecurringTransaction {
  id: number;
  type: TxnType;
  category: string;
  amount: number;
  note: string | null;
  posted_through: string;
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
