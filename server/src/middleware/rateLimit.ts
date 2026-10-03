import rateLimit, { Options } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

// Keyed by client IP — behind a reverse proxy (Caddy in production) that is
// only the real client when TRUST_PROXY is set (see app.ts), otherwise every
// request looks like it comes from the proxy and shares one bucket.
// Skipped under Jest (NODE_ENV=test, read per request) so the suite's many
// register/login calls don't trip it; rateLimit.test.ts flips it back on.
const limiter = (limit: number, message: string, extra: Partial<Options> = {}) =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, res) => {
      res.status(429).json({ error: message });
    },
    ...extra,
  });

/** Password guessing: only failed attempts count, so a user who signs in correctly isn't locked out by earlier typos. */
export const loginLimiter = limiter(10, 'Too many failed sign-in attempts. Try again in 15 minutes.', { skipSuccessfulRequests: true });

export const registerLimiter = limiter(5, 'Too many accounts created from this network. Try again later.');

export const refreshLimiter = limiter(60, 'Too many requests. Try again later.');

/** Anything that sends an email (password reset, verification resend) — stops it being used to spam an inbox. */
export const emailLimiter = limiter(5, 'Too many emails requested. Try again in 15 minutes.');

/** Report issue submissions carry up to a 2 MB screenshot each — cap how much one network can push per window. */
export const issueReportLimiter = limiter(10, 'Too many issue reports. Try again in 15 minutes.');

/**
 * Endpoints that check the account password while signed in (change
 * password, delete account). Keyed per account, not per IP, so a stolen
 * access token can't be used to guess the password from many addresses.
 * Mount after requireAuth.
 */
export const passwordCheckLimiter = limiter(10, 'Too many password attempts. Try again in 15 minutes.', {
  keyGenerator: (req) => `user:${req.userId}`,
});
