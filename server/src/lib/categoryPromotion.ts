// "Improve the common list while keeping the user list intact" (explicit
// product requirement): when enough different users have each independently
// created their own custom category with the same name, one of those rows
// is promoted to a system category (user_id -> NULL) so every *future*
// transaction — for any user — can use it without recreating it.
//
// Deliberately additive, never destructive:
//  - Every other user's own identically-named custom category is left
//    completely alone — same key, same transactions, still theirs to
//    rename/delete. Nothing about their data changes.
//  - The one row that gets promoted keeps its key, so any transaction
//    already referencing it (even the original creator's own) keeps
//    working unchanged — only its `group` and ownership flip.
//  - Only category *labels* are read here, never any financial data —
//    this respects the same per-user privacy boundary as everything else
//    (see docs/README.md §3a).

import { eq, isNull, isNotNull } from 'drizzle-orm';
import { db as defaultDb } from '../db/client';
import { categories } from '../db/schema';

export const PROMOTION_THRESHOLD = 3;
export const PROMOTED_GROUP = 'Community';

const normalize = (label: string) => label.trim().toLowerCase();

export interface PromotionResult {
  key: string;
  label: string;
  type: string;
  adopters: number;
}

/** Exported separately from the CLI entrypoint (batch-promote-categories.ts) so tests can call it directly with a lower threshold, without needing 3 real accounts. */
export async function promoteCommonCategories(database: typeof defaultDb = defaultDb, threshold = PROMOTION_THRESHOLD): Promise<PromotionResult[]> {
  const customRows = await database.select().from(categories).where(isNotNull(categories.userId));
  const systemRows = await database.select({ label: categories.label, type: categories.type }).from(categories).where(isNull(categories.userId));
  const systemKeys = new Set(systemRows.map((s) => `${s.type}|${normalize(s.label)}`));

  const groups = new Map<string, typeof customRows>();
  for (const row of customRows) {
    const groupKey = `${row.type}|${normalize(row.label)}`;
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(row);
    else groups.set(groupKey, [row]);
  }

  const promoted: PromotionResult[] = [];

  for (const [groupKey, rows] of groups) {
    if (systemKeys.has(groupKey)) continue; // already common — nothing to do

    const distinctAdopters = new Set(rows.map((r) => r.userId)).size;
    if (distinctAdopters < threshold) continue;

    // The earliest-created of the matching rows becomes the shared one —
    // arbitrary but stable, and it's the row most likely already referenced
    // by the most history.
    const representative = rows.reduce((earliest, r) => (r.id < earliest.id ? r : earliest));

    await database.update(categories).set({ userId: null, group: PROMOTED_GROUP }).where(eq(categories.key, representative.key));
    promoted.push({ key: representative.key, label: representative.label, type: representative.type, adopters: distinctAdopters });
  }

  return promoted;
}
