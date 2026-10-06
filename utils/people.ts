import { COLORS } from '../constants/theme';
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
