import { isValidIsoDate } from './dates';
import { RepeatFrequency } from './types';

// "Ends on" for a repeating entry. Mirrors server/src/lib/recurringTransactions.ts:
// an entry posts on the rule's day (29–31 fall back to the month's last day) and
// only while that date is on or before the end date.

export type RepeatEndChoice = { kind: 'months'; months: number } | { kind: 'date'; date: string } | { kind: 'none' };

export const END_PRESET_MONTHS = [3, 6, 12] as const;

const STEP: Record<RepeatFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

/** The posting date for `day` in the given month, falling back to the month's last day. */
const postingDate = (year: number, month: number, day: number): string => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, lastDay))}`;
};

const addMonths = (year: number, month: number, n: number) => {
  const index = year * 12 + (month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/** The same day of the month `n` months on (31 Jan + 1 month = 28/29 Feb). */
export const addMonthsToIso = (iso: string, n: number): string => {
  const [y, m, d] = parts(iso);
  const next = addMonths(y, m, n);
  return postingDate(next.year, next.month, d);
};

/** The date of the first automatic entry after an original dated `entryDate`. */
export const firstRepeatDate = (entryDate: string, frequency: RepeatFrequency): string => {
  const [y, m, d] = parts(entryDate);
  const next = addMonths(y, m, STEP[frequency]);
  return postingDate(next.year, next.month, d);
};

/** The end date a choice means, counted from `base` (the entry's date, or today when editing); null for "no end date" or an unusable date. */
export const endsOnFor = (base: string, choice: RepeatEndChoice | null): string | null => {
  if (!choice || choice.kind === 'none') return null;
  if (choice.kind === 'months') return addMonthsToIso(base, choice.months);
  return isValidIsoDate(choice.date) ? choice.date : null;
};

/** Why a choice can't be saved yet, or null when it can. `base` is the earliest allowed end date. */
export const repeatEndError = (base: string, choice: RepeatEndChoice | null): string | null => {
  if (!choice) return 'Choose when this ends.';
  if (choice.kind === 'date') {
    if (!isValidIsoDate(choice.date)) return 'Enter the end date as YYYY-MM-DD.';
    if (choice.date < base) return "The end date can't be before the first entry.";
  }
  return null;
};

/** Request fields for a valid choice: an end date, or the explicit "no end date". */
export const endPayload = (base: string, choice: RepeatEndChoice): { ends_on: string } | { no_end: true } => {
  const endsOn = endsOnFor(base, choice);
  return endsOn ? { ends_on: endsOn } : { no_end: true };
};

/** The entries a repeat would add from `firstDue` until `endsOn`: how many, and the first and last dates. */
export const repeatPreview = (
  firstDue: string,
  frequency: RepeatFrequency,
  day: number,
  endsOn: string
): { count: number; first: string | null; last: string | null } => {
  let [y, m] = parts(firstDue);
  let count = 0;
  let first: string | null = null;
  let last: string | null = null;
  // 600 periods is 50 years of monthly entries — far beyond the server's own limit.
  for (let i = 0; i < 600; i++) {
    const date = postingDate(y, m, day);
    if (date > endsOn) break;
    if (date >= firstDue) {
      count++;
      first ??= date;
      last = date;
    }
    ({ year: y, month: m } = addMonths(y, m, STEP[frequency]));
  }
  return { count, first, last };
};

const daysBetween = (from: string, to: string): number => {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
};

export const formatEndDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** How a rule's end shows in the list: the text, and whether it needs the user's attention. */
export const endStatus = (rule: { ends_on?: string | null; no_end?: boolean }, today: string): { text: string; warn: boolean } => {
  if (rule.ends_on) {
    const days = daysBetween(today, rule.ends_on);
    if (days >= 0 && days <= 31) return { text: days === 0 ? 'ends today' : `ends in ${days} ${days === 1 ? 'day' : 'days'}`, warn: true };
    return { text: `ends ${formatEndDate(rule.ends_on)}`, warn: false };
  }
  if (rule.no_end) return { text: 'no end date', warn: false };
  return { text: 'needs an end date', warn: true };
};
