import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const signAccessToken = (userId: number): string => {
  return jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { expiresIn: ACCESS_TOKEN_TTL });
};

/** Raw refresh token (sent to client, never stored) + its SHA-256 hash (stored in refresh_tokens.token_hash). */
export const generateRefreshToken = (): { token: string; hash: string } => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
};

export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};
