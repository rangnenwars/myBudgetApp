import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { loans } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { notFound } from '../lib/errors';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1),
  principal: z.coerce.number().positive(),
  outstanding: z.coerce.number().min(0),
  emi: z.coerce.number().positive(),
  interest_rate: z.coerce.number().nullish(),
});

const updateSchema = createSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(loans).where(and(eq(loans.userId, req.userId!), eq(loans.is_active, true))).orderBy(desc(loans.id));
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [row] = await db
      .insert(loans)
      .values({
        userId: req.userId!,
        name: body.name,
        principal: body.principal,
        outstanding: body.outstanding,
        emi: body.emi,
        interest_rate: body.interest_rate ?? null,
      })
      .returning();
    res.status(201).json(row);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = updateSchema.parse(req.body);

    const updateData: Partial<typeof loans.$inferInsert> = { updated_at: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.principal !== undefined) updateData.principal = body.principal;
    if (body.outstanding !== undefined) updateData.outstanding = body.outstanding;
    if (body.emi !== undefined) updateData.emi = body.emi;
    if (body.interest_rate !== undefined) updateData.interest_rate = body.interest_rate ?? null;

    const [row] = await db
      .update(loans)
      .set(updateData)
      .where(and(eq(loans.id, id), eq(loans.userId, req.userId!)))
      .returning();
    if (!row) throw notFound('Loan not found.');
    res.json(row);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(loans)
      .where(and(eq(loans.id, id), eq(loans.userId, req.userId!)))
      .returning({ id: loans.id });
    if (!deleted) throw notFound('Loan not found.');
    res.status(204).send();
  })
);

export default router;
