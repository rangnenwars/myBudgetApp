import { z } from 'zod';
import { badRequest } from './errors';
import { isValidIsoDate } from '../../../utils/dates';

/** `%text%` for ILIKE with the user's own % _ \ escaped, so searching "50%" matches that text instead of everything. */
export const likeContains = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A real calendar date as YYYY-MM-DD — rejects 2026-02-30 and 2026-13-01, which a bare regex lets through to a database error. */
export const isoDate = (field = 'date') => z.string().refine(isValidIsoDate, { message: `${field} must be a valid date (YYYY-MM-DD)` });

/** Upper bound for numeric(12,2) money columns, so an oversized amount is a 400 instead of a database overflow. */
export const MAX_AMOUNT = 9_999_999_999.99;
// numeric(12,2): anything that rounds to 0.00 would trip the amount > 0 CHECK and surface as a 500, so refuse it here.
export const money = () =>
  z.coerce
    .number()
    .positive()
    .max(MAX_AMOUNT, 'Amount is too large.')
    .refine((n) => Math.round(n * 100) >= 1, 'Amount must be at least ₹0.01.');

/** `:id` route param as a positive integer — a non-numeric id is a 400, not a database error (500). */
export const idParam = (req: { params: Record<string, string> }, name = 'id'): number => {
  const raw = req.params[name];
  if (!/^\d{1,15}$/.test(raw ?? '') || Number(raw) < 1) throw badRequest(`Invalid ${name}.`);
  return Number(raw);
};

/** Optional free text: trimmed, capped, empty → null. */
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters.`).nullish().transform((v) => v || null);
