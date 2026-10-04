import { Request, Response } from 'express';
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { users, refreshTokens, userTokens } from '../db/schema';
import { signAccessToken, generateRefreshToken, hashToken, REFRESH_TOKEN_TTL_MS } from './tokens';
import { readCookie } from './cookies';
import { appUrl, linkEmail, sendAccountMail } from './accountMail';

// Session helpers shared by routes/auth.ts (sign-in) and routes/account.ts
// (password, verification, account deletion).

// ---------- refresh-token transport ----------
// Native apps keep the refresh token in the device keychain and send it in
// the body. The web app has nowhere script-proof to store it, so it opts in
// with this header and the token travels only in an httpOnly cookie that
// JavaScript (and so any injected script) can never read. Honouring the
// cookie only alongside the custom header also forces a CORS preflight, on
// top of SameSite=Strict, so another site can't drive /refresh or /logout.
export const REFRESH_COOKIE = 'mb_refresh';
const COOKIE_PATH = '/api/v1/auth';

export const wantsCookie = (req: Request): boolean => req.get('X-Refresh-Transport') === 'cookie';

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict' as const,
  // Plain http on localhost in dev; https everywhere in production.
  secure: process.env.NODE_ENV === 'production',
  path: COOKIE_PATH,
});

export const incomingRefreshToken = (req: Request, bodyToken: string | undefined): string | undefined =>
  bodyToken ?? (wantsCookie(req) ? readCookie(req, REFRESH_COOKIE) : undefined);

/** Sends the pair the way the client asked for it: refresh token in the body (native) or only in the cookie (web). */
export const sendTokens = (req: Request, res: Response, tokens: { accessToken: string; refreshToken: string }) => {
  if (!wantsCookie(req)) return tokens;
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieOptions(), maxAge: REFRESH_TOKEN_TTL_MS });
  return { accessToken: tokens.accessToken };
};

export const clearRefreshCookie = (req: Request, res: Response) => {
  if (wantsCookie(req)) res.clearCookie(REFRESH_COOKIE, cookieOptions());
};

// ---------- users ----------

export const toUserResponse = (user: typeof users.$inferSelect) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  tier: user.tier,
  budgetClass: user.budgetClass,
  role: user.role,
  isActive: user.isActive,
  emailVerified: user.emailVerifiedAt != null,
});

// Matches idx_users_email_lower exactly, so lookups use that index instead
// of scanning users (register also stores emails lowercased).
export const emailMatches = (email: string) => eq(sql`lower(${users.email})`, email.toLowerCase());

export const pgErrorCode = (err: unknown): string | undefined =>
  (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;

// ---------- refresh tokens ----------

export const issueTokenPair = async (userId: number) => {
  // Housekeeping: every login/refresh adds a row, so prune this user's dead
  // ones here rather than letting refresh_tokens grow forever.
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), or(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.expiresAt, new Date()))));

  const accessToken = signAccessToken(userId);
  const { token: refreshToken, hash } = generateRefreshToken();
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return { accessToken, refreshToken };
};

/**
 * Signs the user out on every device, immediately: every refresh token is
 * revoked, and users.tokens_valid_after makes requireAuth reject any access
 * token issued before now (a fresh pair issued right after still works).
 */
export const revokeAllRefreshTokens = async (userId: number) => {
  const now = new Date();
  await db.update(users).set({ tokensValidAfter: now }).where(eq(users.id, userId));
  await db.update(refreshTokens).set({ revokedAt: now }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
};

// ---------- emailed single-use tokens ----------

type UserTokenPurpose = 'password_reset' | 'email_verify';

const USER_TOKEN_TTL_MS: Record<UserTokenPurpose, number> = {
  password_reset: 60 * 60 * 1000, // 1 hour
  email_verify: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/** Creates a fresh token for `purpose`, invalidating any earlier unused one, and returns the raw value (only ever sent by email). */
export const createUserToken = async (userId: number, purpose: UserTokenPurpose): Promise<string> => {
  // Housekeeping, as with refresh tokens: a token that's used or expired
  // can never be redeemed again, so drop it instead of keeping it forever.
  await db
    .delete(userTokens)
    .where(and(eq(userTokens.userId, userId), or(isNotNull(userTokens.usedAt), lt(userTokens.expiresAt, new Date()))));
  await db
    .update(userTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(userTokens.userId, userId), eq(userTokens.purpose, purpose), isNull(userTokens.usedAt)));
  const { token, hash } = generateRefreshToken();
  await db.insert(userTokens).values({ userId, purpose, tokenHash: hash, expiresAt: new Date(Date.now() + USER_TOKEN_TTL_MS[purpose]) });
  return token;
};

/** Marks the token used and returns its user id, or null if it is unknown, expired, already used or for another purpose. Single statement, so a token can't be used twice. */
export const consumeUserToken = async (token: string, purpose: UserTokenPurpose): Promise<number | null> => {
  const [row] = await db
    .update(userTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(userTokens.tokenHash, hashToken(token)), eq(userTokens.purpose, purpose), isNull(userTokens.usedAt), gt(userTokens.expiresAt, new Date())))
    .returning({ userId: userTokens.userId });
  return row?.userId ?? null;
};

export const sendVerificationEmail = async (user: { id: number; email: string }) => {
  const token = await createUserToken(user.id, 'email_verify');
  await sendAccountMail(
    linkEmail(
      user.email,
      'Confirm your email for My Budget',
      'Please confirm this is your email address so you can reset your password if you ever forget it.',
      'Confirm email',
      `${appUrl()}/verify-email?token=${token}`,
      "This link works for 7 days. If you didn't create a My Budget account, you can ignore this email."
    )
  );
};

export const sendPasswordResetEmail = async (user: { id: number; email: string }) => {
  const token = await createUserToken(user.id, 'password_reset');
  await sendAccountMail(
    linkEmail(
      user.email,
      'Reset your My Budget password',
      'Someone asked to reset the password for your My Budget account.',
      'Choose a new password',
      `${appUrl()}/reset-password?token=${token}`,
      "This link works for 1 hour and only once. If you didn't ask for this, ignore this email — your password stays the same."
    )
  );
};
