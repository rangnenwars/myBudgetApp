import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

// Express recognizes this as error-handling middleware purely by arity (4 params) — do not remove any parameter even if unused.
export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof AppError) {
    res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues.map((i) => i.message).join('; ') });
    return;
  }
  // express.json() errors (malformed JSON, body over the limit) carry their own 4xx status.
  const bodyErr = err as { type?: string; status?: number };
  if (bodyErr?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large. Screenshots must be 2 MB or smaller.' });
    return;
  }
  if (bodyErr?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body.' });
    return;
  }
  // Never log the raw error: Drizzle's message embeds the failed SQL and its
  // parameters (amounts, notes, emails). Log only the driver code/message.
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  console.error('[500]', e?.cause?.code ?? e?.code ?? e?.name ?? 'Error', e?.cause?.message ?? (e?.cause ? '' : e?.message?.split('\n')[0].replace(/params:.*$/s, '')));
  res.status(500).json({ error: 'Internal server error' });
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' });
};
