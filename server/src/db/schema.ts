// Mirrors docs/DATABASE_DESIGN.md exactly. If you change a table here,
// update that doc's DDL in the same commit — they must not drift.

import {
  pgTable,
  bigserial,
  bigint,
  text,
  numeric,
  smallint,
  boolean,
  date,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================
// users — declared before categories so categories.userId can reference it
// ============================================================
export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  tier: text('tier').notNull().default('standard'),
  budgetClass: text('budget_class'),
  // 'admin' can manage every account via /api/v1/admin/users; 'support' can
  // only activate/deactivate one (routes/admin.ts enforces the split, not
  // this column); 'system_manager' gets read-only aggregate metrics via
  // /api/v1/system/metrics and never touches an individual account; 'user' can do neither.
  role: text('role').notNull().default('user'),
  // Deactivated accounts are rejected at login and at refresh — see routes/auth.ts.
  isActive: boolean('is_active').notNull().default(true),
  // Set/cleared alongside isActive in routes/admin.ts — updatedAt is touched
  // by any field change (role/tier too), so it can't answer "inactive since when" on its own.
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  // Set on successful register/login (routes/auth.ts) — powers the
  // system-manager usage metrics; not updated on token refresh.
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_users_email_lower').on(sql`lower(${table.email})`),
  check('users_tier_check', sql`${table.tier} IN ('standard', 'pro')`),
  check('users_role_check', sql`${table.role} IN ('user', 'admin', 'support', 'system_manager')`),
  check('users_budget_class_check', sql`${table.budgetClass} IN ('low', 'middle', 'high', 'ultra_high', 'rich')`),
]);

// ============================================================
// categories — lookup table. System rows (user_id NULL) are seeded from
// constants/categories.ts; user_id NOT NULL rows are a user's own custom
// categories, added via POST /api/v1/categories.
// ============================================================
export const categories = pgTable('categories', {
  // Secondary auto-incrementing column purely to preserve stable ordering
  // (constants/categories.ts's group order for system rows, then each
  // user's custom categories in creation order) — key stays the primary
  // key since transactions/budgets reference it directly.
  id: bigserial('id', { mode: 'number' }).notNull(),
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  icon: text('icon').notNull(),
  color: text('color').notNull(),
  group: text('group').notNull(),
  type: text('type').notNull(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('categories_type_check', sql`${table.type} IN ('income', 'expense')`),
  uniqueIndex('idx_categories_id').on(table.id),
  index('idx_categories_user').on(table.userId),
]);

// ============================================================
// refresh_tokens
// ============================================================
export const refreshTokens = pgTable('refresh_tokens', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_refresh_tokens_user').on(table.userId),
]);

// ============================================================
// transactions
// ============================================================
export const transactions = pgTable('transactions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  // JS property is `category`, not `category_key` — matches utils/types.ts's
  // Transaction shape exactly so rows can flow straight into
  // utils/calculations.ts with no mapping layer. The SQL column is still
  // named category_key (self-documenting as the FK it is).
  category: text('category_key').notNull().references(() => categories.key),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  subcategory: text('subcategory'),
  note: text('note'),
  date: date('date').notNull(),
  month: smallint('month').notNull(),
  year: smallint('year').notNull(),
  // mode: 'string' — utils/types.ts's Transaction.created_at is a string
  // (ISO), matching the SQLite/localStorage convention; nothing in
  // calculations.ts parses it as a Date, so keep the wire format identical
  // rather than returning a JS Date object here.
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_transactions_user_month').on(table.userId, table.year, table.month),
  index('idx_transactions_user_type_category').on(table.userId, table.type, table.category),
  check('transactions_amount_check', sql`${table.amount} > 0`),
  check('transactions_type_check', sql`${table.type} IN ('income', 'expense')`),
  check('transactions_month_check', sql`${table.month} BETWEEN 1 AND 12`),
]);

// ============================================================
// recurring_transactions — "repeat every month" rules. The user's first
// entry is a normal transaction; this row makes the same amount post again on
// the 1st of every following month (lib/recurringTransactions.ts). Stopping
// a repeat deletes the row — transactions already posted stay.
// ============================================================
export const recurringTransactions = pgTable('recurring_transactions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text('category_key').notNull().references(() => categories.key),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  note: text('note'),
  // First day of the latest month already posted (the month of the user's
  // original entry, advanced as months are posted). Kept on the rule, not
  // derived from transactions, so deleting a posted transaction doesn't
  // make it reappear.
  posted_through: date('posted_through').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_recurring_user').on(table.userId),
  check('recurring_amount_check', sql`${table.amount} > 0`),
  check('recurring_type_check', sql`${table.type} IN ('income', 'expense')`),
]);

// ============================================================
// loans
// ============================================================
// Below the id/user_id/name/principal/outstanding/emi columns, every field
// name matches utils/types.ts's Loan shape exactly (snake_case JS
// properties, not Drizzle's usual camelCase convention) — same reasoning
// as transactions.category above: lets rows flow into
// utils/calculations.ts with no mapping layer.
export const loans = pgTable('loans', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  principal: numeric('principal', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  outstanding: numeric('outstanding', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  emi: numeric('emi', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  interest_rate: numeric('interest_rate', { precision: 5, scale: 2, mode: 'number' }),
  tenure_months: smallint('tenure_months'),
  start_date: date('start_date'),
  loan_type: text('loan_type'),
  lender: text('lender'),
  note: text('note'),
  is_active: boolean('is_active').notNull().default(true),
  // When false, no monthly EMI expense is posted for this loan (the debt
  // still counts as a liability in Reports).
  counts_as_expense: boolean('counts_as_expense').notNull().default(true),
  // First day of the latest month whose EMI expense has been auto-posted for
  // this loan (null = none yet, so only the current month is posted next).
  // Kept on the loan, not derived from transactions, so deleting an
  // auto-posted transaction doesn't make it reappear.
  emi_expensed_through: date('emi_expensed_through'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_loans_user_active').on(table.userId).where(sql`${table.is_active}`),
  check('loans_principal_check', sql`${table.principal} > 0`),
  check('loans_outstanding_check', sql`${table.outstanding} >= 0`),
  check('loans_emi_check', sql`${table.emi} > 0`),
]);

// ============================================================
// investments — snake_case JS properties, see loans comment above
// ============================================================
export const investments = pgTable('investments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  current_value: numeric('current_value', { precision: 12, scale: 2, mode: 'number' }),
  start_date: date('start_date'),
  maturity_date: date('maturity_date'),
  returns_percent: numeric('returns_percent', { precision: 6, scale: 2, mode: 'number' }),
  note: text('note'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_investments_user').on(table.userId),
  check('investments_amount_check', sql`${table.amount} > 0`),
]);

// ============================================================
// savings_goals — snake_case JS properties, see loans comment above
// ============================================================
export const savingsGoals = pgTable('savings_goals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  target_amount: numeric('target_amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  saved_amount: numeric('saved_amount', { precision: 12, scale: 2, mode: 'number' }).notNull().default(0),
  deadline: date('deadline'),
  color: text('color').notNull().default('#10B981'),
  icon: text('icon').notNull().default('star'),
  note: text('note'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_goals_user').on(table.userId),
  check('goals_target_check', sql`${table.target_amount} > 0`),
  check('goals_saved_check', sql`${table.saved_amount} >= 0`),
]);

// ============================================================
// goal_contributions — history of add/remove funds actions against a
// savings goal, purely so the user can see how saved_amount got where it
// is. savings_goals.saved_amount stays the source of truth for progress;
// this table never needs to be summed to recompute it.
// ============================================================
export const goalContributions = pgTable('goal_contributions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  goal_id: bigint('goal_id', { mode: 'number' }).notNull().references(() => savingsGoals.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  type: text('type', { enum: ['add', 'remove'] }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_goal_contributions_goal').on(table.goal_id, table.created_at),
  check('goal_contributions_amount_check', sql`${table.amount} > 0`),
  check('goal_contributions_type_check', sql`${table.type} IN ('add', 'remove')`),
]);

// ============================================================
// net_worth_snapshots
// ============================================================
export const netWorthSnapshots = pgTable('net_worth_snapshots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  month: smallint('month').notNull(),
  year: smallint('year').notNull(),
  netWorth: numeric('net_worth', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_net_worth_user_month').on(table.userId, table.year, table.month),
  check('net_worth_month_check', sql`${table.month} BETWEEN 1 AND 12`),
]);

// ============================================================
// budgets — per-category monthly limits (unused by any screen today, kept for continuity)
// ============================================================
export const budgets = pgTable('budgets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryKey: text('category_key').notNull().references(() => categories.key),
  monthlyLimit: numeric('monthly_limit', { precision: 12, scale: 2, mode: 'number' }).notNull(),
}, (table) => [
  uniqueIndex('idx_budgets_user_category').on(table.userId, table.categoryKey),
  check('budgets_limit_check', sql`${table.monthlyLimit} > 0`),
]);

// ============================================================
// admin_audit_log — one row per role/tier/active/delete change made
// through /api/v1/admin/users, by an admin or support account.
// actor/target ids are ON DELETE SET NULL (not CASCADE) so a log entry
// survives the account it describes being deleted or its actor later
// removed; actorEmail/targetEmail are snapshotted at write time so the
// entry stays readable even after that. Account metadata only — never
// touches transactions/loans/investments/goals, same invariant as the
// admin routes themselves.
// ============================================================
export const adminAuditLog = pgTable('admin_audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: bigint('actor_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email').notNull(),
  targetId: bigint('target_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
  targetEmail: text('target_email').notNull(),
  action: text('action').notNull(),
  details: text('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_admin_audit_actor').on(table.actorId),
  index('idx_admin_audit_target').on(table.targetId),
  index('idx_admin_audit_created').on(table.createdAt),
]);
