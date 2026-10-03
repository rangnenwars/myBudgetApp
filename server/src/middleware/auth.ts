import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { unauthorized } from '../lib/errors';

interface AccessTokenPayload {
  userId: number;
  iat: number; // seconds
}

// Verifies the access token, then confirms the account still exists, is
// active and hasn't ended all sessions since the token was issued (one
// primary-key lookup), so deactivation, deletion, password changes and
// "sign out everywhere" take effect on the very next request instead of
// when the 15-minute token expires.
export const requireAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Missing or malformed Authorization header'));
    return;
  }

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(header.slice('Bearer '.length), process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload;
  } catch {
    next(unauthorized('Invalid or expired access token'));
    return;
  }

  try {
    const [user] = await db
      .select({ isActive: users.isActive, role: users.role, tokensValidAfter: users.tokensValidAfter })
      .from(users)
      .where(eq(users.id, payload.userId));
    if (!user) return next(unauthorized('User no longer exists.'));
    if (!user.isActive) return next(unauthorized('Account no longer active.'));
    // Signed out everywhere / password changed since this token was issued.
    // Second granularity (iat): a pair issued in the same second as the change stays valid.
    if (user.tokensValidAfter && payload.iat < Math.floor(user.tokensValidAfter.getTime() / 1000)) {
      return next(unauthorized('Session ended. Please sign in again.'));
    }
    req.userId = payload.userId;
    // Fresh from the database on every request — the staff checks
    // (requireAdmin/requireStaff/requireSystemManager) use it as-is.
    req.role = user.role;
    next();
  } catch (err) {
    next(err);
  }
};
