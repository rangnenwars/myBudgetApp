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

import { api } from './api';
import { TxnType, Transaction, RecurringTransaction, Loan, Investment, SavingsGoal, GoalContribution, MonthSummary, CategoryTotal } from './types';
import { Category, CategoryType } from '../constants/categories';

export * from './types';
export * from './calculations';

// ---------- Transactions ----------

/** `repeat_monthly` also saves a rule so the same entry posts again on the 1st of every following month. */
export const addTransaction = async (t: Omit<Transaction, 'id' | 'created_at'> & { repeat_monthly?: boolean }): Promise<Transaction> => {
  const { data } = await api.post('/transactions', {
    amount: t.amount,
    type: t.type,
    category_key: t.category,
    subcategory: t.subcategory,
    note: t.note,
    date: t.date,
    repeat_monthly: t.repeat_monthly,
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

export const deleteTransaction = async (id: number): Promise<void> => {
  await api.delete(`/transactions/${id}`);
};

export const getTransactions = async (month?: number, year?: number): Promise<Transaction[]> => {
  const { data } = await api.get('/transactions', { params: { month, year } });
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

/** CSV text for the range, straight from the server (same transactionsToCsv the client's own calculations.ts exports — see reports.ts on the server). */
export const getExportCsv = async (startMonth: number, startYear: number, endMonth: number, endYear: number): Promise<string> => {
  const { data } = await api.get('/reports/export.csv', { params: { startMonth, startYear, endMonth, endYear }, responseType: 'text' });
  return data;
};

// ---------- Repeating (monthly) entries ----------

export const getRecurring = async (): Promise<RecurringTransaction[]> => {
  const { data } = await api.get('/recurring');
  return data;
};

/** Makes an existing transaction repeat monthly (posting resumes from the month after it). */
export const repeatTransactionMonthly = async (transactionId: number): Promise<RecurringTransaction> => {
  const { data } = await api.post('/recurring', { transaction_id: transactionId });
  return data;
};

/** A new amount applies to months not yet posted; already-posted transactions keep theirs. */
export const updateRecurring = async (id: number, patch: Partial<{ amount: number; note: string | null }>): Promise<RecurringTransaction> => {
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
    counts_as_expense: l.counts_as_expense,
  });
  return data;
};

export const updateLoan = async (
  id: number,
  patch: Partial<{ name: string; principal: number; outstanding: number; emi: number; interest_rate: number | null; counts_as_expense: boolean }>
): Promise<Loan> => {
  const { data } = await api.patch(`/loans/${id}`, patch);
  return data;
};

/** Marks one EMI as paid: the server lowers `outstanding` only. It does not log an expense — a counted loan's monthly EMI is posted automatically by the server, and an excluded loan stays out of expenses. */
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
}

export const getAdminUsers = async (): Promise<AdminUser[]> => {
  const { data } = await api.get('/admin/users');
  return data;
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
