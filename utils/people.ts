import { COLORS } from '../constants/theme';
import { splitEqually } from './calculations';
import { LedgerKind, Person } from './types';

/** ₹1,200 for whole rupees, ₹1,200.50 when there are paise. */
export const fmtAmount = (n: number): string => {
  const abs = Math.abs(n);
  const whole = Number.isInteger(abs);
  return '₹' + abs.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};

/** "You get ₹600", "You owe ₹500" or "Settled", with a colour. The words carry the meaning, not only the colour. */
export const balanceLabel = (balance: number): { text: string; color: string } => {
  if (balance > 0) return { text: `You get ${fmtAmount(balance)}`, color: COLORS.positive };
  if (balance < 0) return { text: `You owe ${fmtAmount(balance)}`, color: COLORS.red };
  return { text: 'Settled', color: COLORS.textDim };
};

export const KIND_LABEL: Record<LedgerKind, string> = {
  lent: 'Lent',
  borrowed: 'Borrowed',
  received: 'Paid back to you',
  repaid: 'You paid back',
  written_off: 'Written off',
  split_share: 'Shared bill',
};

export type PeopleFilter = 'all' | 'get' | 'owe' | 'overdue';

export const filterPeople = (people: Person[], filter: PeopleFilter): Person[] => {
  if (filter === 'get') return people.filter((p) => p.balance > 0);
  if (filter === 'owe') return people.filter((p) => p.balance < 0);
  if (filter === 'overdue') return people.filter((p) => p.overdue);
  return people;
};

/** "30 Sep" or "30 Sep 2027" when it isn't this year. */
export const shortDate = (iso: string, now: Date = new Date()): string => {
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};

// ---------- Splitting a bill with people ----------

export interface PeopleSplitState {
  /** Ids of the people picked from the list. */
  picked: number[];
  method: 'equal' | 'custom';
  /** Typed share per person id; key 0 is the new person typed in. */
  shares: Record<number, string>;
  newName: string;
}

export const emptyPeopleSplit = (): PeopleSplitState => ({ picked: [], method: 'equal', shares: {}, newName: '' });

/** Key used for the person being added by name. */
export const NEW_PERSON = 0;

const rowKeys = (v: PeopleSplitState): number[] => [...v.picked, ...(v.newName.trim() ? [NEW_PERSON] : [])];

/** Each friend's share and what stays with the user, for the amount typed so far. */
export const planPeopleSplit = (total: number, v: PeopleSplitState): { keys: number[]; shares: Record<number, number>; myShare: number } => {
  const keys = rowKeys(v);
  const shares: Record<number, number> = {};
  if (v.method === 'equal') {
    const { friendShare } = splitEqually(total, keys.length);
    for (const k of keys) shares[k] = friendShare;
  } else {
    for (const k of keys) shares[k] = parseFloat(v.shares[k] ?? '') || 0;
  }
  const friendsCents = keys.reduce((s, k) => s + Math.round(shares[k] * 100), 0);
  return { keys, shares, myShare: (Math.round(total * 100) - friendsCents) / 100 };
};

/** Why the split can't be saved yet, or null when it can. */
export const peopleSplitProblem = (total: number, v: PeopleSplitState): string | null => {
  if (!(total > 0)) return 'Enter how much you paid.';
  const plan = planPeopleSplit(total, v);
  if (plan.keys.length === 0) return 'Choose who shared it.';
  if (plan.keys.some((k) => !(plan.shares[k] > 0))) return v.method === 'equal' ? 'That amount is too small to split.' : "Enter each person's share.";
  if (plan.myShare < 0) return `The shares are ${fmtAmount(-plan.myShare)} more than the total.`;
  return null;
};
