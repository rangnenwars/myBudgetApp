// Pure helpers for the calendar sheet (components/CalendarSheet.tsx). Dates are
// 'YYYY-MM-DD' strings in local time; weeks start on Monday.

const pad = (n: number) => String(n).padStart(2, '0');

export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const isoOf = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

/** The cells of a month grid: leading blanks (null) so day 1 sits under its weekday, then 1..N. */
export const monthCells = (year: number, month: number): (number | null)[] => {
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
};

/** True when `iso` is before `min` or after `max` (either bound may be left out). */
export const outOfRange = (iso: string, min?: string, max?: string): boolean => (!!min && iso < min) || (!!max && iso > max);

/** True when no day of the month can be picked within the bounds. */
export const monthOutOfRange = (year: number, month: number, min?: string, max?: string): boolean => {
  const last = new Date(year, month, 0).getDate();
  return outOfRange(isoOf(year, month, 1), undefined, max) || outOfRange(isoOf(year, month, last), min, undefined);
};

/** The month `delta` months from the given one, rolling over years. */
export const addMonthsTo = (year: number, month: number, delta: number): { year: number; month: number } => {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};
