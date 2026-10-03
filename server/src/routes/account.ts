import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db/client';
import {
  users,
  categories,
  transactions,
  recurringTransactions,
  loans,
  investments,
  savingsGoals,
  goalContributions,
  netWorthSnapshots,
  budgets,
  accounts,
} from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { emailLimiter, passwordCheckLimiter } from '../middleware/rateLimit';
import {
  clearRefreshCookie,
  consumeUserToken,
  emailMatches,
  issueTokenPair,
  revokeAllRefreshTokens,
  sendPasswordResetEmail,
  sendTokens,
  sendVerificationEmail,
  toUserResponse,
} from '../lib/session';
import { BCRYPT_COST, passwordSchema } from './auth';

// Self-service account management, mounted alongside routes/auth.ts under
// /api/v1/auth: forgotten-password reset and email verification (both via a
// single-use emailed link — lib/session.ts), change password, sign out
// everywhere, download all your data, and delete your account.
const router = Router();

const tokenSchema = z.object({ token: z.string().min(1).max(200) });

// ---------- forgotten password ----------

// Always 204, whether or not the email is registered, so this can't be used
// to find out who has an account. Deactivated accounts get no email.
router.post(
  '/forgot-password',
  emailLimiter,
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email') }).parse(req.body);
    const [user] = await db.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users).where(emailMatches(email));
    if (user?.isActive) {
      await sendPasswordResetEmail(user).catch((err) => console.error('Password reset email failed:', err));
    }
    res.status(204).send();
  })
);

// Sets a new password from the emailed link and signs the account out
// everywhere — whoever knew the old password loses their session too.
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const body = tokenSchema.extend({ password: passwordSchema }).parse(req.body);
    const userId = await consumeUserToken(body.token, 'password_reset');
    if (!userId) throw badRequest('This reset link is invalid or has expired. Ask for a new one.');

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    // Opening the emailed link also proves the address belongs to them.
    const [user] = await db.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date(), emailVerifiedAt: user?.emailVerifiedAt ?? new Date() })
      .where(eq(users.id, userId));
    await revokeAllRefreshTokens(userId);
    res.status(204).send();
  })
);

// ---------- email verification ----------

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = tokenSchema.parse(req.body);
    const userId = await consumeUserToken(token, 'email_verify');
    if (!userId) throw badRequest('This confirmation link is invalid or has expired. Send a new one from the app.');
    const [user] = await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    res.json(toUserResponse(user));
  })
);

router.post(
  '/me/resend-verification',
  requireAuth,
  emailLimiter,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
    if (!user) throw unauthorized('User no longer exists.');
    if (user.emailVerifiedAt) throw badRequest('Your email is already confirmed.');
    await sendVerificationEmail(user);
    res.status(204).send();
  })
);

// ---------- signed-in account management ----------

const verifyPassword = async (userId: number, password: string) => {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw unauthorized('User no longer exists.');
  if (!(await bcrypt.compare(password, user.passwordHash))) throw badRequest('Your current password is incorrect.');
  return user;
};

// Changes the password, signs out every other device, and hands this device
// a fresh session so it stays signed in.
router.post(
  '/me/password',
  requireAuth,
  passwordCheckLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema }).parse(req.body);
    await verifyPassword(req.userId!, body.currentPassword);
    if (body.currentPassword === body.newPassword) throw badRequest('Choose a password different from your current one.');

    const passwordHash = await bcrypt.hash(body.newPassword, BCRYPT_COST);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, req.userId!));
    await revokeAllRefreshTokens(req.userId!);

    const tokens = await issueTokenPair(req.userId!);
    res.json(sendTokens(req, res, tokens));
  })
);

// Ends every session, including this one: no refresh token survives, so
// each device is signed out within one access-token lifetime (15 min).
router.post(
  '/me/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllRefreshTokens(req.userId!);
    clearRefreshCookie(req, res);
    res.status(204).send();
  })
);

// Everything the account owns, as one JSON file. Excludes the password hash
// and session tokens.
router.get(
  '/me/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw unauthorized('User no longer exists.');

    const [txns, rules, userLoans, userInvestments, goals, userAccounts, userBudgets, customCategories, snapshots] = await Promise.all([
      db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(transactions.date, transactions.id),
      db.select().from(recurringTransactions).where(eq(recurringTransactions.userId, userId)),
      db.select().from(loans).where(eq(loans.userId, userId)),
      db.select().from(investments).where(eq(investments.userId, userId)),
      db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)),
      db.select().from(accounts).where(eq(accounts.userId, userId)),
      db.select().from(budgets).where(eq(budgets.userId, userId)),
      db.select().from(categories).where(eq(categories.userId, userId)),
      db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.userId, userId)),
    ]);
    const contributions = goals.length
      ? await db.select().from(goalContributions).where(inArray(goalContributions.goal_id, goals.map((g) => g.id)))
      : [];

    const strip = <T extends { userId?: number | null }>(rows: T[]) => rows.map(({ userId: _omit, ...rest }) => rest);
    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: { ...toUserResponse(user), createdAt: user.createdAt },
      transactions: strip(txns),
      repeatingEntries: strip(rules),
      loans: strip(userLoans),
      investments: strip(userInvestments),
      goals: strip(goals).map((g) => ({ ...g, contributions: strip(contributions.filter((c) => c.goal_id === g.id)) })),
      accounts: strip(userAccounts),
      budgets: strip(userBudgets),
      customCategories: strip(customCategories),
      netWorthHistory: strip(snapshots),
    };

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="mybudget-export-${date}.json"`);
    res.json(exportData);
  })
);

// Permanently deletes the account and everything it owns (FK cascades).
// Requires the password again so a borrowed, unlocked device can't do it.
router.delete(
  '/me',
  requireAuth,
  passwordCheckLimiter,
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1, 'Enter your password to confirm') }).parse(req.body ?? {});
    const user = await verifyPassword(req.userId!, password);

    // The admin surface must never be left without an admin.
    if (user.role === 'admin') {
      const [{ others }] = await db
        .select({ others: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, user.id)));
      if (others === 0) throw conflict('You are the only admin. Make someone else an admin before deleting your account.');
    }

    await db.delete(users).where(eq(users.id, user.id));
    clearRefreshCookie(req, res);
    res.status(204).send();
  })
);

export default router;
