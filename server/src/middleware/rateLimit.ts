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
