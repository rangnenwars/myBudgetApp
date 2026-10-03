import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { notFound } from '../lib/errors';

// Bank/cash/wallet balances and credit-card dues, typed in by the user and
// counted in net worth (credit cards subtract). Not linked to transactions —
// the user updates a balance whenever they like.
const router = Router();
router.use(requireAuth);

const MAX_BALANCE = 999_999_999_999.99; // numeric(14,2)

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  type: z.enum(['bank', 'cash', 'wallet', 'credit_card']),
  balance: z.coerce.number().min(-MAX_BALANCE).max(MAX_BALANCE).default(0),
});

const updateSchema = createSchema
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(accounts).where(eq(accounts.userId, req.userId!)).orderBy(asc(accounts.id));
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [row] = await db.insert(accounts).values({ userId: req.userId!, ...body }).returning();
    res.status(201).json(row);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = updateSchema.parse(req.body);
    const [row] = await db
      .update(accounts)
      .set({ ...body, updated_at: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.userId, req.userId!)))
      .returning();
    if (!row) throw notFound('Account not found.');
    res.json(row);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const [deleted] = await db
      .delete(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, req.userId!)))
      .returning({ id: accounts.id });
    if (!deleted) throw notFound('Account not found.');
    res.status(204).send();
  })
);

export default router;
