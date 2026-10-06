// The client's data layer, now backed by the real API server instead of
// on-device SQLite/localStorage (see docs/MASTER_BUILD_PROMPT_v3_BACKEND.md).
// One file for both platforms — the old database.ts/database.web.ts split
// existed only because native/web needed different *storage* backends;
// HTTP via axios works identically on both, so there's nothing left to
// split. Auth (register/login/refresh/logout/me/tier) lives in
// AuthContext, which calls `api` directly — this file is CRUD only.
//
// Function names/shapes intentionally mirror the old local data layer
// (same names, same param order minus the userId the server now derives
// from the JWT) so screen call sites needed minimal changes.

import type { FeatureKey } from '../constants/features';
import { api } from './api';
import {
  TxnType,
  Transaction,
  RecurringTransaction,
  RepeatFrequency,
  Loan,
  Investment,
  SavingsGoal,
  GoalContribution,
  MonthSummary,
  CategoryTotal,
  Account,
  AccountType,
  BudgetStatus,
  OverallBudget,
  FreeMoneyDayInfo,
  Person,
  PeopleSummary,
  LedgerEntry,
  LedgerKind,
} from './types';
import { Category, CategoryType } from '../constants/categories';

export * from './types';
export * from './calculations';

// ---------- Transactions ----------

/** `repeat_frequency` (or the older `repeat_monthly: true`) also saves a rule so the same entry posts again every month/quarter/year on the entry's day. */
export const addTransaction = async (
  t: Omit<Transaction, 'id' | 'created_at'> & { repeat_monthly?: boolean; repeat_frequency?: RepeatFrequency }
): Promise<Transaction> => {
  const { data } = await api.post('/transactions', {
    amount: t.amount,
    type: t.type,
    category_key: t.category,
    subcategory: t.subcategory,
    note: t.note,
    date: t.date,
    repeat_monthly: t.repeat_monthly,
    repeat_frequency: t.repeat_frequency,
  });
  return data;
};

/** Saves several entries in one all-or-nothing request — either all are saved or none (no half-saved batch to re-submit as duplicates). */
export const addTransactionsBatch = async (entries: Omit<Transaction, 'id' | 'created_at' | 'month' | 'year'>[]): Promise<Transaction[]> => {
  const { data } = await api.post('/transactions/batch', {
    entries: entries.map((t) => ({ amount: t.amount, type: t.type, category_key: t.category, subcategory: t.subcategory, note: t.note, date: t.date })),
  });
  return data;
};

/** One payment shared across categories: saves a linked entry per line, all or nothing. The lines must add up to `total`. */
export const addSplitTransaction = async (input: {
  type: TxnType;
  date: string;
  total: number;
  note?: string | null;
  lines: { category: string; amount: number }[];
}): Promise<{ splitGroup: string; entries: Transaction[] }> => {
  const { data } = await api.post('/transactions/split', {
    type: input.type,
    date: input.date,
    total: input.total,
    note: input.note,
    lines: input.lines.map((l) => ({ category_key: l.category, amount: l.amount })),
  });
  return data;
};

/** A bill you paid for several people: your share becomes the one spending entry, each friend's share what they owe you. */
export const addSplitWithPeople = async (input: {
  date: string;
  total: number;
  category: string;
  note?: string | null;
  method: 'equal' | 'custom';
  people: { personId: number; amount?: number }[];
}): Promise<{ transaction: Transaction | null; myShare: number; shares: { personId: number; name: string; amount: number }[] }> => {
  const { data } = await api.post('/transactions/split-people', {
    date: input.date,
    total: input.total,
    category_key: input.category,
    note: input.note,
    method: input.method,
    people: input.people.map((p) => ({ person_id: p.personId, amount: p.amount })),
  });
  return data;
};

export const updateTransaction = async (
  id: number,
  patch: Partial<{ amount: number; type: TxnType; category: string; subcategory: string | null; note: string | null; date: string }>
): Promise<Transaction> => {
  const { data } = await api.patch(`/transactions/${id}`, {
    amount: patch.amount,
    type: patch.type,
    category_key: patch.category,
    subcategory: patch.subcategory,
    note: patch.note,
    date: patch.date,
  });
  return data;
};

/** `stopRepeat` also deletes the repeating rule the entry belongs to. */
export const deleteTransaction = async (id: number, stopRepeat = false): Promise<void> => {
  await api.delete(`/transactions/${id}`, { params: stopRepeat ? { stop_repeat: true } : undefined });
};

export const getTransactions = async (month?: number, year?: number): Promise<Transaction[]> => {
  const { data } = await api.get('/transactions', { params: { month, year } });
  return data;
};

export interface TransactionPageQuery {
  q?: string;
  type?: TxnType;
  category?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
}

/** One newest-first page with server-side search/filters; pass the returned nextCursor to get the next page (null = no more). */
export const getTransactionsPage = async (query: TransactionPageQuery): Promise<{ items: Transaction[]; nextCursor: string | null }> => {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const { data } = await api.get('/transactions/page', { params });
  return data;
};

export const getTransactionsForRange = async (startMonth: number, startYear: number, endMonth: number, endYear: number): Promise<Transaction[]> => {
  const { data } = await api.get('/transactions/range', { params: { startMonth, startYear, endMonth, endYear } });
  return data;
};

export const getMonthSummary = async (month: number, year: number): Promise<MonthSummary> => {
  const { data } = await api.get('/reports/summary', { params: { startMonth: month, startYear: year, endMonth: month, endYear: year } });
  return data;
};

export const getCategoryBreakdown = async (month: number, year: number, type: TxnType): Promise<CategoryTotal[]> => {
  const { data } = await api.get('/reports/category-breakdown', { params: { startMonth: month, startYear: year, endMonth: month, endYear: year, type } });
  return data;
};

export const getRangeSummary = async (startMonth: number, startYear: number, endMonth: number, endYear: number): Promise<MonthSummary> => {
  const { data } = await api.get('/reports/summary', { params: { startMonth, startYear, endMonth, endYear } });
  return data;
};

export const getCategoryBreakdownForRange = async (
  startMonth: number,
  startYear: number,
  endMonth: number,
  endYear: number,
  type: TxnType
): Promise<CategoryTotal[]> => {
  const { data } = await api.get('/reports/category-breakdown', { params: { startMonth, startYear, endMonth, endYear, type } });
  return data;
};

export const getMonthlySeriesForRange = async (startMonth: number, startYear: number, endMonth: number, endYear: number) => {
  const { data } = await api.get('/reports/monthly-series', { params: { startMonth, startYear, endMonth, endYear } });
  return data;
};

export const getFreeMoneyDay = async (): Promise<FreeMoneyDayInfo> => {
  const { data } = await api.get('/reports/free-money-day');
  return data;
};

/** CSV text for the range, straight from the server (same transactionsToCsv the client's own calculations.ts exports — see reports.ts on the server). */
export const getExportCsv = async (startMonth: number, startYear: number, endMonth: number, endYear: number): Promise<string> => {
  const { data } = await api.get('/reports/export.csv', { params: { startMonth, startYear, endMonth, endYear }, responseType: 'text' });
  return data;
};

// ---------- Repeating entries ----------

export const getRecurring = async (): Promise<RecurringTransaction[]> => {
  const { data } = await api.get('/recurring');
  return data;
};

/** Makes an existing transaction repeat (on its own day of the month), starting one period after it. */
export const repeatTransactionMonthly = async (transactionId: number, frequency: RepeatFrequency = 'monthly'): Promise<RecurringTransaction> => {
  const { data } = await api.post('/recurring', { transaction_id: transactionId, frequency });
  return data;
};

/** Changes apply to entries not yet posted; already-posted transactions keep theirs. */
export const updateRecurring = async (
  id: number,
  patch: Partial<{ amount: number; note: string | null; frequency: RepeatFrequency; day_of_month: number }>
): Promise<RecurringTransaction> => {
  const { data } = await api.patch(`/recurring/${id}`, patch);
  return data;
};

/** Stops the repeat. Transactions already posted stay. */
export const deleteRecurring = async (id: number): Promise<void> => {
  await api.delete(`/recurring/${id}`);
};

// ---------- Loans ----------

export const addLoan = async (l: Omit<Loan, 'id' | 'is_active' | 'counts_as_expense'> & { counts_as_expense?: boolean }): Promise<Loan> => {
  const { data } = await api.post('/loans', {
    name: l.name,
    principal: l.principal,
    outstanding: l.outstanding,
    emi: l.emi,
    interest_rate: l.interest_rate,
    tenure_months: l.tenure_months,
    start_date: l.start_date,
    loan_type: l.loan_type,
    lender: l.lender,
    note: l.note,
    counts_as_expense: l.counts_as_expense,
  });
  return data;
};

export const updateLoan = async (
  id: number,
  patch: Partial<{
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
    counts_as_expense: boolean;
  }>
): Promise<Loan> => {
  const { data } = await api.patch(`/loans/${id}`, patch);
  return data;
};

/** Marks one EMI as paid on a loan that does NOT count as an expense: lowers `outstanding`, logs nothing. Counted loans are refused — the server posts their EMI and pays the balance down automatically each month. */
export const payLoanEmi = async (id: number, date: string): Promise<{ loan: Loan }> => {
  const { data } = await api.post(`/loans/${id}/pay-emi`, { date });
  return data;
};

/** Part payment / prepayment: the server lowers `outstanding` by `amount` and scales `emi` down proportionally (see computePartPayment). Logs an expense transaction only if the loan counts as an expense. */
export const payLoanPartial = async (id: number, amount: number, date: string): Promise<{ loan: Loan; transaction: Transaction | null }> => {
  const { data } = await api.post(`/loans/${id}/part-payment`, { amount, date });
  return data;
};

export const deleteLoan = async (id: number): Promise<void> => {
  await api.delete(`/loans/${id}`);
};

export const getLoans = async (): Promise<Loan[]> => {
  const { data } = await api.get('/loans');
  return data;
};

// ---------- Investments ----------

export const addInvestment = async (i: Omit<Investment, 'id'>): Promise<Investment> => {
  const { data } = await api.post('/investments', {
    name: i.name,
    type: i.type,
    amount: i.amount,
    current_value: i.current_value,
  });
  return data;
};

export const updateInvestment = async (
  id: number,
  patch: Partial<{ name: string; type: string; amount: number; current_value: number | null }>
): Promise<Investment> => {
  const { data } = await api.patch(`/investments/${id}`, patch);
  return data;
};

export const deleteInvestment = async (id: number): Promise<void> => {
  await api.delete(`/investments/${id}`);
};

export const getInvestments = async (): Promise<Investment[]> => {
  const { data } = await api.get('/investments');
  return data;
};

// ---------- Savings goals ----------

export const addGoal = async (g: Omit<SavingsGoal, 'id'>): Promise<SavingsGoal> => {
  const { data } = await api.post('/goals', { name: g.name, target_amount: g.target_amount, deadline: g.deadline });
  return data;
};

export const updateGoal = async (
  id: number,
  patch: Partial<{ name: string; target_amount: number; saved_amount: number; deadline: string | null }>
): Promise<SavingsGoal> => {
  const { data } = await api.patch(`/goals/${id}`, patch);
  return data;
};

export const deleteGoal = async (id: number): Promise<void> => {
  await api.delete(`/goals/${id}`);
};

export const getGoals = async (): Promise<SavingsGoal[]> => {
  const { data } = await api.get('/goals');
  return data;
};

/** Adds or removes funds from a goal. Server enforces saved_amount can't go negative (can't remove more than is saved) and records the action. */
export const contributeToGoal = async (id: number, amount: number, type: 'add' | 'remove'): Promise<{ goal: SavingsGoal; contribution: GoalContribution }> => {
  const { data } = await api.post(`/goals/${id}/contributions`, { amount, type });
  return data;
};

export const getGoalContributions = async (id: number): Promise<GoalContribution[]> => {
  const { data } = await api.get(`/goals/${id}/contributions`);
  return data;
};

// ---------- Categories ----------
// System categories plus the caller's own custom ones (server-merged,
// see server/src/routes/categories.ts) — consumed via CategoriesContext,
// not called directly by screens.

export const getCategories = async (): Promise<Category[]> => {
  const { data } = await api.get('/categories');
  return data;
};

export const addCategory = async (input: { name: string; type: CategoryType }): Promise<Category> => {
  const { data } = await api.post('/categories', input);
  return data;
};

export const renameCategory = async (key: string, name: string): Promise<Category> => {
  const { data } = await api.patch(`/categories/${key}`, { name });
  return data;
};

export const deleteCategory = async (key: string): Promise<void> => {
  await api.delete(`/categories/${key}`);
};

// ---------- Admin (role: 'admin' only — see context/AuthContext.tsx isAdmin) ----------

export type AdminRole = 'user' | 'admin' | 'support' | 'system_manager';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  tier: 'standard' | 'pro';
  isActive: boolean;
  budgetClass: string | null;
  createdAt: string;
  deactivatedAt: string | null;
  lastLoginAt: string | null;
  emailVerified: boolean;
}

/** Newest accounts first, searched by name/email on the server; `total` is how many match in all. */
export const getAdminUsers = async (q?: string, limit = 100, offset = 0): Promise<{ items: AdminUser[]; total: number }> => {
  const res = await api.get('/admin/users', { params: { q: q || undefined, limit, offset } });
  return { items: res.data, total: Number(res.headers['x-total-count'] ?? res.data.length) };
};

export const updateAdminUser = async (
  id: number,
  patch: Partial<{ role: AdminRole; isActive: boolean; tier: 'standard' | 'pro' }>
): Promise<AdminUser> => {
  const { data } = await api.patch(`/admin/users/${id}`, patch);
  return data;
};

export const deleteAdminUser = async (id: number): Promise<void> => {
  await api.delete(`/admin/users/${id}`);
};

// ---------- Net worth snapshots ----------

export const recordNetWorthSnapshot = async (): Promise<void> => {
  await api.post('/net-worth/snapshot');
};

export const getNetWorthSnapshots = async (): Promise<{ month: number; year: number; net_worth: number }[]> => {
  const { data } = await api.get('/net-worth/history');
  return data.map((s: { month: number; year: number; netWorth: number }) => ({ month: s.month, year: s.year, net_worth: s.netWorth }));
};

// ---------- Money accounts (bank / cash / wallet / credit card) ----------

export const getAccounts = async (): Promise<Account[]> => {
  const { data } = await api.get('/accounts');
  return data;
};

export const addAccount = async (a: { name: string; type: AccountType; balance: number }): Promise<Account> => {
  const { data } = await api.post('/accounts', a);
  return data;
};

export const updateAccount = async (id: number, patch: Partial<{ name: string; type: AccountType; balance: number }>): Promise<Account> => {
  const { data } = await api.patch(`/accounts/${id}`, patch);
  return data;
};

export const deleteAccount = async (id: number): Promise<void> => {
  await api.delete(`/accounts/${id}`);
};

// ---------- Budgets (monthly limit per expense category) ----------

/** Every limit with the month's spending against it, most-used first. */
export const getBudgets = async (month?: number, year?: number): Promise<BudgetStatus[]> => {
  const { data } = await api.get('/budgets', { params: { month, year } });
  return data;
};

export const setBudget = async (categoryKey: string, monthlyLimit: number): Promise<void> => {
  await api.put(`/budgets/${categoryKey}`, { monthly_limit: monthlyLimit });
};

export const deleteBudget = async (categoryKey: string): Promise<void> => {
  await api.delete(`/budgets/${categoryKey}`);
};

// ---------- Overall monthly budget (one number; category limits sit inside it) ----------

export const getOverallBudget = async (month?: number, year?: number): Promise<OverallBudget> => {
  const { data } = await api.get('/budgets/overall', { params: { month, year } });
  return data;
};

export const setOverallBudget = async (amount: number, includeCommitments: boolean): Promise<void> => {
  await api.put('/budgets/overall', { amount, include_commitments: includeCommitments });
};

export const clearOverallBudget = async (): Promise<void> => {
  await api.delete('/budgets/overall');
};

// ---------- Your account (password reset, verification, export) ----------
// Sign-in/out, change password and account deletion live in AuthContext
// because they change the session; these are the stand-alone calls.

export const requestPasswordReset = async (email: string): Promise<void> => {
  await api.post('/auth/forgot-password', { email });
};

export const resetPassword = async (token: string, password: string): Promise<void> => {
  await api.post('/auth/reset-password', { token, password });
};

export const verifyEmail = async (token: string): Promise<void> => {
  await api.post('/auth/verify-email', { token });
};

export const resendVerificationEmail = async (): Promise<void> => {
  await api.post('/auth/me/resend-verification');
};

/** Everything the account owns, as pretty-printed JSON text ready to save. */
export const exportMyData = async (): Promise<string> => {
  const { data } = await api.get('/auth/me/export');
  return JSON.stringify(data, null, 2);
};

// ---------- Staff: audit log (admin) and system metrics (admin, system manager) ----------

export interface AuditLogEntry {
  id: number;
  actorEmail: string;
  targetEmail: string;
  action: string;
  details: string | null;
  createdAt: string;
}

/** Newest first, `limit` at a time; pass the last id shown as `before` for the next (older) page. */
export const getAuditLog = async (before?: number, limit = 100): Promise<AuditLogEntry[]> => {
  const { data } = await api.get('/admin/audit-log', { params: { before, limit } });
  return data;
};

export interface SystemMetrics {
  users: { total: number; active: number; inactive: number; byRole: Record<AdminRole, number>; byTier: Record<'standard' | 'pro', number> };
  signups: { last30Days: number };
  engagement: { loggedInLast30Days: number; loggedInLast7Days: number };
  usage: { transactions: number; loans: number; investments: number; goals: number; customCategories: number };
  finance: {
    costPerUserPerYearInr: number;
    estimatedAnnualCostInr: number;
    proUsers: number;
    estimatedAnnualRevenueInr: number;
    estimatedAnnualMarginInr: number;
    revenueNote: string;
  };
}

export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const { data } = await api.get('/system/metrics');
  return data;
};

// ---------- People (lending, borrowing, shared bills) ----------

export const getPeople = async (): Promise<PeopleSummary> => {
  const { data } = await api.get('/people');
  return data;
};

export const addPerson = async (name: string): Promise<Person> => {
  const { data } = await api.post('/people', { name });
  return data;
};

export const getPerson = async (id: number): Promise<{ person: Person; entries: LedgerEntry[] }> => {
  const { data } = await api.get(`/people/${id}`);
  return data;
};

/** `due_date: null` clears the pay-back-by date. */
export const updatePerson = async (id: number, patch: { name?: string; due_date?: string | null }): Promise<Person> => {
  const { data } = await api.patch(`/people/${id}`, patch);
  return data;
};

export const deletePerson = async (id: number): Promise<void> => {
  await api.delete(`/people/${id}`);
};

/** A write-off clears the whole balance, so it takes no amount. */
export const addPersonEntry = async (
  id: number,
  entry: { kind: LedgerKind; amount?: number; date?: string; note?: string | null; due_date?: string | null }
): Promise<{ entry: LedgerEntry; person: Person }> => {
  const { data } = await api.post(`/people/${id}/entries`, entry);
  return data;
};

export const deletePersonEntry = async (id: number, entryId: number): Promise<void> => {
  await api.delete(`/people/${id}/entries/${entryId}`);
};

// ============================================================
// Optional features — staff switch Goals/Loans/Investments per user; the
// user can only see theirs and ask for one (server routes/features.ts).
// ============================================================

export interface MyFeature {
  key: FeatureKey;
  label: string;
  description: string;
  on: boolean;
  /** Asked for and waiting on staff. */
  requested: boolean;
}

export const getMyFeatures = async (): Promise<MyFeature[]> => {
  const { data } = await api.get('/features');
  return data;
};

export const requestFeature = async (key: FeatureKey): Promise<MyFeature> => {
  const { data } = await api.post(`/features/${key}/request`);
  return data;
};

// ---------- Feature access, staff side (server routes/adminFeatures.ts) ----------

export interface UserFeatureAccess {
  key: FeatureKey;
  label: string;
  on: boolean;
  source: 'default' | 'existing_data' | 'admin' | 'request' | null;
  changedByEmail: string | null;
  updatedAt: string | null;
  /** The user asked for it and is waiting. */
  requestedAt: string | null;
}

export type SignupFeatureDefaults = Record<FeatureKey, boolean>;

export interface FeatureOverview {
  defaults: SignupFeatureDefaults;
  totalUsers: number;
  features: { key: FeatureKey; label: string; usersOn: number }[];
  requests: { userId: number; name: string; email: string; feature: FeatureKey; requestedAt: string }[];
}

export interface FeatureUser {
  id: number;
  name: string;
  email: string;
  source: string;
  updatedAt: string;
}

export const getFeatureOverview = async (): Promise<FeatureOverview> => {
  const { data } = await api.get('/admin/features');
  return data;
};

export const saveSignupFeatureDefaults = async (defaults: SignupFeatureDefaults): Promise<SignupFeatureDefaults> => {
  const { data } = await api.put('/admin/features/defaults', defaults);
  return data;
};

export const getFeatureUsers = async (key: FeatureKey): Promise<{ items: FeatureUser[]; total: number }> => {
  const res = await api.get(`/admin/features/${key}/users`, { params: { limit: 100 } });
  return { items: res.data, total: Number(res.headers['x-total-count'] ?? res.data.length) };
};

export const getUserFeatureAccess = async (userId: number): Promise<UserFeatureAccess[]> => {
  const { data } = await api.get(`/admin/users/${userId}/features`);
  return data;
};

export const setUserFeature = async (userId: number, key: FeatureKey, on: boolean): Promise<UserFeatureAccess> => {
  const { data } = await api.put(`/admin/users/${userId}/features/${key}`, { on });
  return data;
};
