import { db } from '../db/client';
import { adminAuditLog } from '../db/schema';

// Fire-and-forget from the caller's point of view (routes await it, but a
// failure here shouldn't be possible to distinguish from a slow request —
// there's no conditional skip). Emails are snapshotted by the caller so the
// entry stays readable after the account it describes is deleted.
export const recordAdminAction = (entry: {
  actorId: number;
  actorEmail: string;
  targetId: number;
  targetEmail: string;
  action: string;
  details?: string;
}) => db.insert(adminAuditLog).values(entry);
