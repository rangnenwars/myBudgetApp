import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { people, peopleLedger } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { localToday } from '../lib/clock';
import { badRequest, conflict, notFound } from '../lib/errors';
import { idParam, isoDate, money, optionalText } from '../lib/validation';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const MAX_PEOPLE = 500;
const cents = (n: number) => Math.round(n * 100);
const rupees = (c: number) => c / 100;
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const name = z.string().trim().min(1, 'Enter a name.').max(60, 'Keep the name under 60 characters.');

const createSchema = z.object({ name });
const patchSchema = z
  .object({ name: name.optional(), due_date: isoDate('due_date').nullable().optional() })
  .refine((b) => b.name !== undefined || b.due_date !== undefined, { message: 'Provide a name or a due date.' });

const entrySchema = z.object({
  kind: z.enum(['lent', 'borrowed', 'received', 'repaid', 'written_off']),
  amount: money().optional(),
  date: isoDate().optional(),
  note: optionalText(500),
  due_date: isoDate('due_date').nullish(),
});

/** Sign of each kind: + means they owe the user more, − means the user owes more or they paid back. */
const SIGN = { lent: 1, repaid: 1, borrowed: -1, received: -1, written_off: -1 } as const;

type PersonRow = typeof people.$inferSelect;

const present = (p: PersonRow, balance: number, today: string, lastDate?: string | null) => ({
  id: p.id,
  name: p.name,
  balance,
  dueDate: p.dueDate,
  overdue: cents(balance) !== 0 && p.dueDate != null && p.dueDate < today,
  lastActivity: lastDate ?? null,
});

const balanceOf = async (personId: number): Promise<number> => {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${peopleLedger.amount}), 0)` })
    .from(peopleLedger)
    .where(eq(peopleLedger.personId, personId));
  return Number(row.total);
};

const findPerson = async (userId: number, id: number): Promise<PersonRow> => {
  const [p] = await db.select().from(people).where(and(eq(people.id, id), eq(people.userId, userId)));
  if (!p) throw notFound('Person not found.');
  return p;
};

// Everyone with their balance, plus what the user is owed and owes in total.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const today = localToday().iso;
    const rows = await db
      .select({
        person: people,
        balance: sql<string>`coalesce(sum(${peopleLedger.amount}), 0)`,
        lastDate: sql<string | null>`max(${peopleLedger.date})`,
      })
      .from(people)
      .leftJoin(peopleLedger, eq(peopleLedger.personId, people.id))
      .where(eq(people.userId, req.userId!))
      .groupBy(people.id)
      .orderBy(asc(sql`lower(${people.name})`));

    const items = rows.map((r) => present(r.person, Number(r.balance), today, r.lastDate));
    const youGet = items.reduce((s, p) => s + Math.max(cents(p.balance), 0), 0);
    const youOwe = items.reduce((s, p) => s + Math.max(-cents(p.balance), 0), 0);
    res.json({ youGet: rupees(youGet), youOwe: rupees(youOwe), people: items });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(people).where(eq(people.userId, req.userId!));
    if (n >= MAX_PEOPLE) throw badRequest(`You can keep up to ${MAX_PEOPLE} people.`);
    const [existing] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, req.userId!), sql`lower(${people.name}) = lower(${body.name})`));
    if (existing) throw conflict(`${body.name} is already in your list.`);
    const [row] = await db.insert(people).values({ userId: req.userId!, name: body.name }).returning();
    res.status(201).json(present(row, 0, localToday().iso));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const person = await findPerson(req.userId!, idParam(req));
    const entries = await db
      .select({ id: peopleLedger.id, kind: peopleLedger.kind, amount: peopleLedger.amount, date: peopleLedger.date, note: peopleLedger.note })
      .from(peopleLedger)
      .where(eq(peopleLedger.personId, person.id))
      .orderBy(desc(peopleLedger.date), desc(peopleLedger.id));
    const balance = rupees(entries.reduce((s, e) => s + cents(e.amount), 0));
    res.json({ person: present(person, balance, localToday().iso, entries[0]?.date), entries });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = patchSchema.parse(req.body);
    const person = await findPerson(req.userId!, id);
    if (body.name !== undefined && body.name.toLowerCase() !== person.name.toLowerCase()) {
      const [clash] = await db
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.userId, req.userId!), sql`lower(${people.name}) = lower(${body.name})`));
      if (clash) throw conflict(`${body.name} is already in your list.`);
    }
    const set: Partial<typeof people.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) set.name = body.name;
    if (body.due_date !== undefined) set.dueDate = body.due_date;
    const [row] = await db.update(people).set(set).where(eq(people.id, id)).returning();
    res.json(present(row, await balanceOf(id), localToday().iso));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const [deleted] = await db.delete(people).where(and(eq(people.id, id), eq(people.userId, req.userId!))).returning({ id: people.id });
    if (!deleted) throw notFound('Person not found.');
    res.status(204).send();
  })
);

// One line in the ledger: money lent or borrowed, a payment either way, or a write-off.
router.post(
  '/:id/entries',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = entrySchema.parse(req.body);
    const date = body.date ?? localToday().iso;
    if (body.kind === 'written_off' ? body.amount != null : body.amount == null) {
      throw badRequest(body.kind === 'written_off' ? 'A write-off clears the whole balance; leave the amount out.' : 'Enter an amount.');
    }

    const result = await db.transaction(async (tx) => {
      // Lock the person so two quick taps can't both pass the balance check.
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, id), eq(people.userId, req.userId!)))
        .for('update');
      if (!person) throw notFound('Person not found.');

      const [{ total }] = await tx
        .select({ total: sql<string>`coalesce(sum(${peopleLedger.amount}), 0)` })
        .from(peopleLedger)
        .where(eq(peopleLedger.personId, id));
      const balance = cents(Number(total));

      let amountCents: number;
      if (body.kind === 'written_off') {
        if (balance <= 0) throw badRequest(`${person.name} doesn't owe you anything to write off.`);
        amountCents = balance;
      } else {
        amountCents = cents(body.amount!);
        if (body.kind === 'received' && amountCents > Math.max(balance, 0)) {
          throw badRequest(balance > 0 ? `${person.name} only owes you ${inr(rupees(balance))}.` : `${person.name} doesn't owe you anything.`);
        }
        if (body.kind === 'repaid' && amountCents > Math.max(-balance, 0)) {
          throw badRequest(balance < 0 ? `You only owe ${person.name} ${inr(rupees(-balance))}.` : `You don't owe ${person.name} anything.`);
        }
      }

      const [entry] = await tx
        .insert(peopleLedger)
        .values({
          userId: req.userId!,
          personId: id,
          kind: body.kind,
          amount: rupees(SIGN[body.kind] * amountCents),
          date,
          note: body.note ?? null,
        })
        .returning();

      const newBalance = balance + SIGN[body.kind] * amountCents;
      const due = newBalance === 0 ? null : body.due_date !== undefined && body.due_date !== null ? body.due_date : person.dueDate;
      const [updated] = await tx.update(people).set({ dueDate: due, updatedAt: new Date() }).where(eq(people.id, id)).returning();
      return { entry, person: present(updated, rupees(newBalance), localToday().iso, date) };
    });

    res.status(201).json(result);
  })
);

// Undo a mistaken line. The balance is recomputed from what remains.
router.delete(
  '/:id/entries/:entryId',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const entryId = idParam(req, 'entryId');
    await db.transaction(async (tx) => {
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, id), eq(people.userId, req.userId!)))
        .for('update');
      if (!person) throw notFound('Person not found.');
      const [deleted] = await tx
        .delete(peopleLedger)
        .where(and(eq(peopleLedger.id, entryId), eq(peopleLedger.personId, id)))
        .returning({ id: peopleLedger.id });
      if (!deleted) throw notFound('Entry not found.');
      const [{ total }] = await tx
        .select({ total: sql<string>`coalesce(sum(${peopleLedger.amount}), 0)` })
        .from(peopleLedger)
        .where(eq(peopleLedger.personId, id));
      if (cents(Number(total)) === 0) await tx.update(people).set({ dueDate: null, updatedAt: new Date() }).where(eq(people.id, id));
    });
    res.status(204).send();
  })
);

export default router;
