import { z } from 'zod';
import { badRequest } from './errors';
import { isValidIsoDate, shiftIsoDate } from '../../../utils/dates';
import { localToday } from './clock';

/** `%text%` for ILIKE with the user's own % _ \ escaped, so searching "50%" matches that text instead of everything. */
export const likeContains = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Years the app accepts in any date: keeps 0001-01-01 and 9999-12-31 out of the data. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** A real calendar date as YYYY-MM-DD, within 2000–2100 — rejects 2026-02-30 and 2026-13-01, which a bare regex lets through to a database error. */
export const isoDate = (field = 'date') =>
  z
    .string()
    .refine(isValidIsoDate, { message: `${field} must be a valid date (YYYY-MM-DD)` })
    .refine((v) => Number(v.slice(0, 4)) >= MIN_YEAR && Number(v.slice(0, 4)) <= MAX_YEAR, { message: `${field} must be between ${MIN_YEAR} and ${MAX_YEAR}` });

/** A date for something that already happened (a transaction, a payment, a ledger line): not in the future, like the app's own date check. One day of slack covers a client in a timezone ahead of the server. */
export const entryDate = (field = 'date') =>
  isoDate(field).refine((v) => v <= shiftIsoDate(localToday().iso, 1), { message: "The date can't be in the future." });

/**
 * A number from JSON or a query string. Numbers and non-empty numeric strings
 * pass; anything else (an array, a boolean, an object, "") is rejected instead
 * of being coerced to a number by accident ([5] → 5, true → 1).
 * `build` adds the checks: num((n) => n.int().min(1)).
 */
export const num = <T extends z.ZodType = z.ZodNumber>(build: (n: z.ZodNumber) => T = ((n: z.ZodNumber) => n) as unknown as (n: z.ZodNumber) => T) =>
  z.preprocess((v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN), build(z.number({ error: (issue) => (issue.code === 'invalid_type' ? 'Enter a number.' : undefined) })));

/** Upper bound for numeric(12,2) money columns, so an oversized amount is a 400 instead of a database overflow. */
export const MAX_AMOUNT = 9_999_999_999.99;
// numeric(12,2): anything that rounds to 0.00 would trip the amount > 0 CHECK and surface as a 500, so refuse it here.
export const money = () => num((n) => n.min(0.01, 'Amount must be at least ₹0.01.').max(MAX_AMOUNT, 'Amount is too large.'));

/** `:id` route param as a positive integer — a non-numeric id is a 400, not a database error (500). */
export const idParam = (req: { params: Record<string, string> }, name = 'id'): number => {
  const raw = req.params[name];
  if (!/^\d{1,15}$/.test(raw ?? '') || Number(raw) < 1) throw badRequest(`Invalid ${name}.`);
  return Number(raw);
};

/** Optional free text: trimmed, capped, empty → null. */
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters.`).nullish().transform((v) => v || null);
