import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { investments } from '../db/schema';
import { sipMiddleware } from '../lib/sipPosting';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam, isoDate, money, MAX_AMOUNT, num } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { badRequest, notFound } from '../lib/errors';
import { addMonths, localToday } from '../lib/clock';
import { SIP_CATEGORIES, nextSipDate, sipMonthStart } from '../../../utils/sip';

const router = Router();
router.use(requireAuth, requireFeature('investments'), sipMiddleware);

// A SIP: a fixed amount invested every month. It must say when it ends: a date, or no_end.
const sipSchema = z
  .object({
    amount: money(),
    day: num((n) => n.int('Pick a day from 1 to 31.').min(1, 'Pick a day from 1 to 31.').max(31, 'Pick a day from 1 to 31.')),
    category: z.enum(SIP_CATEGORIES, { error: 'Pick where the SIP is added: Mutual funds, Fixed deposit, Bonds or Gold.' }),
    ends_on: isoDate('ends_on').nullish(),
    no_end: z.boolean().optional(),
  })
  .refine((s) => (s.ends_on ? 1 : 0) + (s.no_end ? 1 : 0) === 1, { message: 'Say when the SIP ends: pick an end date, or choose No end date.' });

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(40),
  amount: money(),
  // Can't be negative — an investment's worst case is worth nothing.
  current_value: num((n) => n.min(0).max(MAX_AMOUNT, 'Amount is too large.')).nullish(),
  // Set to start a SIP, null to stop one, left out to leave it as it is.
  sip: sipSchema.nullish(),
});

type SipBody = z.infer<typeof sipSchema>;

/** The SIP columns for an investment row. */
const sipColumns = (sip: SipBody) => ({
  sip_amount: sip.amount,
  sip_day: sip.day,
  sip_category: sip.category,
  sip_ends_on: sip.ends_on ?? null,
  sip_no_end: !!sip.no_end,
});

const assertSipEnd = (sip: SipBody) => {
  if (sip.ends_on && sip.ends_on < localToday().iso) throw badRequest("The SIP's end date can't be in the past.");
};

/** The row as the app sees it: the SIP, if any, plus the date of its next instalment. */
const present = (row: typeof investments.$inferSelect) => ({
  ...row,
  sip_next_date: row.sip_amount != null && row.sip_day != null ? nextSipDate(row.sip_posted_through, row.sip_day, row.sip_ends_on, localToday().iso) : null,
});

const updateSchema = createSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(investments).where(eq(investments.userId, req.userId!)).orderBy(desc(investments.id));
    res.json(rows.map(present));
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (body.sip) assertSipEnd(body.sip);
    // Server owns the derived gain % — never trust a client-computed value for money math.
    const currentValue = body.current_value ?? body.amount;
    const returnsPercent = body.amount > 0 ? ((currentValue - body.amount) / body.amount) * 100 : 0;

    const [row] = await db
      .insert(investments)
      .values({
        userId: req.userId!,
        name: body.name,
        type: body.type,
        amount: body.amount,
        current_value: currentValue,
        returns_percent: returnsPercent,
        start_date: localToday().iso,
        ...(body.sip ? sipColumns(body.sip) : {}),
      })
      .returning();
    res.status(201).json(present(row));
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = updateSchema.parse(req.body);
    if (body.sip) assertSipEnd(body.sip);

    const [existing] = await db.select().from(investments).where(and(eq(investments.id, id), eq(investments.userId, req.userId!)));
    if (!existing) throw notFound('Investment not found.');

    // Recomputed from whichever of amount/current_value actually changed —
    // never accepted from the client, same rule as POST.
    const amount = body.amount ?? existing.amount;
    const currentValue = body.current_value !== undefined ? (body.current_value ?? amount) : existing.current_value ?? amount;
    const returnsPercent = amount > 0 ? ((currentValue - amount) / amount) * 100 : 0;

    const updateData: Partial<typeof investments.$inferInsert> = { updated_at: new Date(), current_value: currentValue, returns_percent: returnsPercent };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.sip === null) {
      // Switched off. Past SIPs stay in Transactions; sip_posted_through is kept so a SIP switched back
      // on in the same month does not add that month again.
      Object.assign(updateData, { sip_amount: null, sip_day: null, sip_category: null, sip_ends_on: null, sip_no_end: false });
    } else if (body.sip) {
      Object.assign(updateData, sipColumns(body.sip));
      // Switched back on after a gap: start from this month, never backfill the months it was off.
      if (existing.sip_amount == null && existing.sip_posted_through) {
        const today = localToday();
        const prev = addMonths(today.year, today.month, -1);
        const previousStart = sipMonthStart(prev.year, prev.month);
        if (existing.sip_posted_through < previousStart) updateData.sip_posted_through = previousStart;
      }
    }

    const [row] = await db.update(investments).set(updateData).where(eq(investments.id, id)).returning();
    res.json(present(row));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const [deleted] = await db
      .delete(investments)
      .where(and(eq(investments.id, id), eq(investments.userId, req.userId!)))
      .returning({ id: investments.id });
    if (!deleted) throw notFound('Investment not found.');
    res.status(204).send();
  })
);

export default router;
