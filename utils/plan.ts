import { api } from './api';
import type { FeatureKey } from '../constants/features';
import type { PlanInfo } from './planState';

// API calls for the paid plan: what the user sees, and the admin controls.
// The server decides every rule (server/src/lib/access.ts); nothing here does.

// ---------- the user's side ----------

export type ClaimStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface MyClaim {
  id: number;
  status: ClaimStatus;
  /** Only the last four characters, e.g. "…1190". */
  txn_id: string;
  amount_inr: number | null;
  created_at: string;
  decided_at: string | null;
  /** The admin's note when the payment was rejected. */
  reason: string | null;
  asked_to_resend: boolean;
  grace_until: string | null;
}

export interface MyPlan {
  plan: PlanInfo;
  claims: MyClaim[];
  payments_set_up: boolean;
}

export type PaymentDetails =
  | { configured: false }
  | { configured: true; upi_id: string; payee_name: string; qr: string; amount_inr: number; period: 'month' | 'year'; upi_link: string };

export const getMyPlan = async (): Promise<MyPlan> => (await api.get('/plan')).data;
export const getPaymentDetails = async (): Promise<PaymentDetails> => (await api.get('/plan/payment-details')).data;

/** "I have paid": the transaction ID and a screenshot (base64 or a data: URL). */
export const submitClaim = async (input: { txn_id: string; screenshot: string; note?: string }): Promise<MyClaim> =>
  (await api.post('/plan/claims', { txn_id: input.txn_id, screenshot: { data: input.screenshot }, note: input.note || undefined })).data;

export const cancelClaim = async (id: number): Promise<MyClaim> => (await api.post(`/plan/claims/${id}/cancel`)).data;

// ---------- admin ----------

export interface AdminPlanSettings {
  price_inr: number;
  period: 'month' | 'year';
  trial_months: number;
  notice_days: number;
  features: FeatureKey[];
  enforced: boolean;
  enforced_at: string | null;
  existing_notice_at: string | null;
}

export interface AdminPlanOverview {
  plan: AdminPlanSettings;
  payments_set_up: boolean;
  stats: { customers: number; company: number; trials: number; paid: number; exceptions: number; pending: number };
}

export const getAdminPlan = async (): Promise<AdminPlanOverview> => (await api.get('/admin/plan')).data;

export const saveAdminPlan = async (body: Pick<AdminPlanSettings, 'price_inr' | 'period' | 'trial_months' | 'notice_days' | 'features'>): Promise<AdminPlanSettings> =>
  (await api.put('/admin/plan', body)).data;

export interface DryRun {
  enforced: boolean;
  existing_notice_at: string | null;
  customers: number;
  would_lose: number;
  users: { id: number; email: string; name: string; plan_end: string | null }[];
}

export const getDryRun = async (): Promise<DryRun> => (await api.get('/admin/plan/dry-run', { params: { limit: 50 } })).data;

export const notifyExistingUsers = async (password: string): Promise<{ emailed: number; extended: number; customers: number }> =>
  (await api.post('/admin/plan/notify-existing', { password })).data;

export const setEnforcement = async (on: boolean, password: string): Promise<AdminPlanSettings> => (await api.put('/admin/plan/enforcement', { on, password })).data;

export interface AdminPaymentDetails {
  configured: boolean;
  upi_id?: string;
  payee_name?: string;
  qr?: string;
  qr_verified?: boolean;
  updated_at?: string;
  updated_by?: string | null;
}

export const getAdminPaymentDetails = async (): Promise<AdminPaymentDetails> => (await api.get('/admin/payment-details')).data;

export const saveAdminPaymentDetails = async (body: { upi_id: string; payee_name: string; qr: string; password: string; confirm_unreadable?: boolean }): Promise<AdminPaymentDetails> =>
  (await api.put('/admin/payment-details', { upi_id: body.upi_id, payee_name: body.payee_name, qr: { data: body.qr }, password: body.password, confirm_unreadable: body.confirm_unreadable })).data;

export interface AdminClaim {
  id: number;
  status: ClaimStatus;
  source: 'user' | 'admin';
  txnId: string;
  amountInr: number | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  reason: string | null;
  graceUntil: string | null;
  hasScreenshot: boolean;
  userId: number;
  email: string;
  name: string;
  /** How many other payments used this same transaction ID and weren't accepted. */
  usedBefore: number;
}

export const getAdminPayments = async (status: ClaimStatus | 'all' = 'pending'): Promise<{ price_inr: number; claims: AdminClaim[] }> =>
  (await api.get('/admin/payments', { params: { status } })).data;

export const getPaymentScreenshot = async (id: number): Promise<string> => (await api.get(`/admin/payments/${id}/screenshot`, { params: { format: 'json' } })).data.data_url;

export const confirmPayment = async (id: number, amountInr?: number): Promise<{ access_until: string }> =>
  (await api.post(`/admin/payments/${id}/confirm`, amountInr != null ? { amount_inr: amountInr } : {})).data;

export const rejectPayment = async (id: number, reason: string, resend: boolean): Promise<void> => {
  await api.post(`/admin/payments/${id}/reject`, { reason, resend });
};

export const markPaymentReceived = async (userId: number, body: { amount_inr: number; txn_id: string; note?: string }): Promise<{ access_until: string }> =>
  (await api.post(`/admin/users/${userId}/payments`, body)).data;

export interface UserAccess {
  account_kind: 'customer' | 'company';
  access: { state: PlanInfo['state']; until: string | null; days_left: number | null; plan_end: string | null; ended_on: string | null };
  exception: { reason: string; ends_at: string | null; since: string } | null;
  grants: { id: number; kind: 'trial' | 'paid' | 'exception'; startsAt: string; endsAt: string | null; reason: string | null; amountInr: number | null; txnId: string | null; revokedAt: string | null; by: string | null }[];
  pending_claims: number;
}

export const getUserAccess = async (userId: number): Promise<UserAccess> => (await api.get(`/admin/users/${userId}/access`)).data;

export const setAccountKind = async (userId: number, kind: 'customer' | 'company'): Promise<void> => {
  await api.put(`/admin/users/${userId}/account-kind`, { kind });
};

/** Turns an exception on (a reason is required; `until` is a YYYY-MM-DD last day, or null for no end) or off. */
export const setException = async (userId: number, body: { on: true; reason: string; until: string | null } | { on: false }): Promise<void> => {
  await api.put(`/admin/users/${userId}/exception`, body.on ? { on: true, reason: body.reason, ...(body.until ? { until: body.until } : {}) } : body);
};

export interface ExceptionRow {
  id: number;
  userId: number;
  email: string;
  name: string;
  reason: string;
  endsAt: string | null;
  since: string;
  by: string | null;
  noEnd: boolean;
}

export const getExceptions = async (filter: 'all' | 'ending_soon' | 'no_end' = 'all'): Promise<ExceptionRow[]> => (await api.get('/admin/exceptions', { params: { filter } })).data;

export interface ExpiringRow {
  id: number;
  email: string;
  name: string;
  plan_end: string;
  ended: boolean;
}

export const getExpiring = async (): Promise<{ ending: ExpiringRow[]; ended: ExpiringRow[]; pending_claims: number }> => (await api.get('/admin/plan/expiring')).data;
