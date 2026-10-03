// Calendar-date helpers working on 'YYYY-MM-DD' strings in the device's local
// time. toISOString() is deliberately avoided for "today": it is UTC, so in
// India between midnight and 5:30am it returns yesterday's date.

const pad = (n: number): string => String(n).padStart(2, '0');

export const toIsoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayLocalIso = (now: Date = new Date()): string => toIsoDate(now);

/** True for a real calendar date in strict YYYY-MM-DD form (rejects 2026-02-30, 2026-13-01, 2026-1-5). */
export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

/** The date `days` before (negative) or after (positive) `value`. Assumes a valid date. */
export const shiftIsoDate = (value: string, days: number): string => {
  const [y, m, d] = value.split('-').map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
};

export const monthYearOf = (value: string): { month: number; year: number } => {
  const [y, m] = value.split('-').map(Number);
  return { month: m, year: y };
};

/** Error text for an entry date, or null when it is a real date that is not after `maxDate` (today). */
export const entryDateError = (value: string, maxDate: string): string | null => {
  if (!isValidIsoDate(value)) return 'Enter a valid date as YYYY-MM-DD.';
  if (value > maxDate) return "The date can't be in the future.";
  return null;
};

/** The month `delta` months before (negative) or after (positive) `value`, rolling over years. */
export const shiftMonth = (value: { month: number; year: number }, delta: number): { month: number; year: number } => {
  const d = new Date(value.year, value.month - 1 + delta, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};
