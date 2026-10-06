import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { users, refreshTokens } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { badRequest, unauthorized, conflict, forbidden } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { loginLimiter, registerLimiter, refreshLimiter } from '../middleware/rateLimit';
import { hashToken } from '../lib/tokens';
import {
  clearRefreshCookie,
  emailMatches,
  incomingRefreshToken,
  issueTokenPair,
  pgErrorCode,
  sendTokens,
  sendVerificationEmail,
  toUserResponse,
  wantsCookie,
} from '../lib/session';

const router = Router();
export const BCRYPT_COST = 12;

// Compared against when the email isn't registered, so an unknown email takes
// as long as a wrong password — otherwise the skipped bcrypt check (~250 ms)
// would reveal which emails have accounts. Same cost as real hashes; made
// once, on first use.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('not-a-real-password', BCRYPT_COST));

// bcrypt only reads the first 72 bytes, so longer passwords would silently
// be truncated — cap them instead.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

// Indian mobile number: 10 digits starting 6–9, with an optional +91 / 91 /
// 0 prefix and any spaces or dashes. Stored as E.164 (+91XXXXXXXXXX).
export const indianMobileSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number')
  .transform((v) => `+91${v}`);

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: indianMobileSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

// Optional: the web client sends no token in the body — it lives in the
// httpOnly cookie instead (lib/session.ts).
const refreshSchema = z.object({ refreshToken: z.string().min(1).optional() });
const tierSchema = z.object({ tier: z.enum(['standard', 'pro']) });

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);

    const [existing] = await db.select({ id: users.id }).from(users).where(emailMatches(body.email));
    if (existing) throw conflict('An account with that email already exists.');
    const [phoneTaken] = await db.select({ id: users.id }).from(users).where(eq(users.phone, body.phone));
    if (phoneTaken) throw conflict('An account with that mobile number already exists.');

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    let user: typeof users.$inferSelect;
    try {
      [user] = await db.insert(users).values({ name: body.name, email: body.email, phone: body.phone, passwordHash, lastLoginAt: new Date() }).returning();
    } catch (err) {
      // Two sign-ups for the same email or number racing past the checks above.
      if (pgErrorCode(err) === '23505') throw conflict('An account with that email or mobile number already exists.');
      throw err;
    }

    // Best-effort: a mail outage must not block sign-up — the app offers "resend".
    await sendVerificationEmail(user).catch((err) => console.error('Verification email failed:', err));

    const tokens = await issueTokenPair(user.id);
    res.status(201).json({ user: toUserResponse(user), ...sendTokens(req, res, tokens) });
  })
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);

    const [user] = await db.select().from(users).where(emailMatches(body.email));
    // Same error, and the same bcrypt work, whether the email doesn't exist or
    // the password is wrong — neither the message nor the timing reveals which.
    const valid = await bcrypt.compare(body.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !valid) throw unauthorized('Invalid email or password.');

    // Checked after the password so a wrong password and a deactivated
    // account still give different messages only once credentials are
    // actually proven correct — doesn't help an attacker enumerate accounts.
    if (!user.isActive) throw forbidden('This account has been deactivated. Contact an administrator.');

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const tokens = await issueTokenPair(user.id);
    res.json({ user: toUserResponse(user), ...sendTokens(req, res, tokens) });
  })
);

router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body ?? {});
    const refreshToken = incomingRefreshToken(req, body.refreshToken);
    if (!refreshToken) {
      clearRefreshCookie(req, res);
      throw unauthorized('Refresh token is invalid or expired.');
    }

    // Revoke-and-return in one statement: of two requests racing with the
    // same token, exactly one gets the row, so a token can never be
    // exchanged twice.
    const [row] = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, hashToken(refreshToken)), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
      .returning({ userId: refreshTokens.userId });

    if (!row) {
      clearRefreshCookie(req, res);
      throw unauthorized('Refresh token is invalid or expired.');
    }

    // Deactivated mid-session: the token was already revoked above, so the
    // access token can't be renewed once it expires (max ~15 min away).
    const [user] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, row.userId));
    if (!user?.isActive) {
      clearRefreshCookie(req, res);
      throw unauthorized('Account no longer active.');
    }

    const tokens = await issueTokenPair(row.userId);
    res.json(sendTokens(req, res, tokens));
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body ?? {});
    const refreshToken = incomingRefreshToken(req, body.refreshToken);
    if (!refreshToken && !wantsCookie(req)) throw badRequest('refreshToken is required.');
    if (refreshToken) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.tokenHash, hashToken(refreshToken)), isNull(refreshTokens.revokedAt)));
    }
    clearRefreshCookie(req, res);
    res.status(204).send();
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
    if (!user) throw unauthorized('User no longer exists.');
    res.json(toUserResponse(user));
  })
);

// Local "Try Pro" toggle — no payment processor exists (see docs/README.md
// "Known deviations"). This is a placeholder for a real billing flow, not
// a real upgrade endpoint. Keep it obviously named so nobody mistakes it
// for production billing later.
// Off in production unless ALLOW_SELF_TIER_CHANGE=true, so nobody can grant
// themselves Pro for free; admins can still set a tier via /admin/users.
// Read per request so tests can toggle it.
const selfTierChangeAllowed = (): boolean =>
  process.env.ALLOW_SELF_TIER_CHANGE != null ? process.env.ALLOW_SELF_TIER_CHANGE === 'true' : process.env.NODE_ENV !== 'production';

router.patch(
  '/me/tier',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!selfTierChangeAllowed()) throw forbidden('Plan changes are not available yet.');
    const { tier } = tierSchema.parse(req.body);
    const [user] = await db.update(users).set({ tier, updatedAt: new Date() }).where(eq(users.id, req.userId!)).returning();
    if (!user) throw badRequest('User not found.');
    res.json(toUserResponse(user));
  })
);

export default router;
