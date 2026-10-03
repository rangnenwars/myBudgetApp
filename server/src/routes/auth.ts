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
import { signAccessToken, generateRefreshToken, hashToken, REFRESH_TOKEN_TTL_MS } from '../lib/tokens';

const router = Router();
const BCRYPT_COST = 12;

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const tierSchema = z.object({ tier: z.enum(['standard', 'pro']) });

const toUserResponse = (user: typeof users.$inferSelect) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  tier: user.tier,
  budgetClass: user.budgetClass,
  role: user.role,
  isActive: user.isActive,
});

const issueTokenPair = async (userId: number) => {
  const accessToken = signAccessToken(userId);
  const { token: refreshToken, hash } = generateRefreshToken();
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return { accessToken, refreshToken };
};

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (existing) throw conflict('An account with that email already exists.');

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    const [user] = await db.insert(users).values({ name: body.name, email: body.email, passwordHash, lastLoginAt: new Date() }).returning();

    const tokens = await issueTokenPair(user.id);
    res.status(201).json({ user: toUserResponse(user), ...tokens });
  })
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    // Same generic error whether the email doesn't exist or the password is wrong — don't reveal which.
    if (!user) throw unauthorized('Invalid email or password.');

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) throw unauthorized('Invalid email or password.');

    // Checked after the password so a wrong password and a deactivated
    // account still give different messages only once credentials are
    // actually proven correct — doesn't help an attacker enumerate accounts.
    if (!user.isActive) throw forbidden('This account has been deactivated. Contact an administrator.');

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const tokens = await issueTokenPair(user.id);
    res.json({ user: toUserResponse(user), ...tokens });
  })
);

router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const hash = hashToken(refreshToken);

    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())));

    if (!row) throw unauthorized('Refresh token is invalid or expired.');

    const [user] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, row.userId));
    if (!user?.isActive) {
      // Deactivated mid-session: kill this refresh token too, so the
      // access token can't be renewed once it expires (max ~15 min away).
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
      throw unauthorized('Account no longer active.');
    }

    // Rotate: revoke the one just used, issue a fresh pair.
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    const tokens = await issueTokenPair(row.userId);
    res.json(tokens);
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const hash = hashToken(refreshToken);
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)));
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
