import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { ACTIVITY_RETENTION_DAYS } from './activity';

/**
 * Keeps raw activity for 90 days. Anything older is first added up into daily counts (per day, kind, page and
 * platform, customer accounts only: anonymous numbers) and then deleted. Runs each night. A day is only ever
 * rolled up whole, because the cut-off is the start of a day.
 */
export const purgeActivity = async (now: Date = new Date()): Promise<{ rolledUp: number; removed: number }> => {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    const rolled = await tx.execute(sql`
      insert into activity_daily (day, kind, page, platform, events, people)
      select (a.created_at at time zone 'UTC')::date, a.kind, coalesce(a.page, ''), coalesce(a.platform, ''), count(*)::int, count(distinct a.user_id)::int
      from user_activity a join users u on u.id = a.user_id
      where a.created_at < ${cutoff} and u.account_kind = 'customer'
      group by 1, 2, 3, 4
      on conflict do nothing`);
    const removed = await tx.execute(sql`delete from user_activity where created_at < ${cutoff}`);
    return { rolledUp: rolled.rowCount ?? 0, removed: removed.rowCount ?? 0 };
  });
};
