import { isValidIsoDate, shiftIsoDate } from './dates';
import { monthBounds } from './txnLink';

import { dateLocale, getLanguage, t } from './i18n';
// Date ranges for the Transactions tab's Dates filter. Weeks run Monday to Sunday.
// Both ends are included. All dates are local calendar days (YYYY-MM-DD).

export type DatePreset = 'week' | 'month' | 'year';

export interface DateRange {
  from: string;
  to: string;
  /** Shown on the chip, e.g. "This week · 16 to 22 Nov". */
  label: string;
  /** Which quick choice this is; absent for a custom range. */
  preset?: DatePreset;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// English uses the fixed names below (steady across devices); Hindi takes its month names from the locale.
const hindi = () => getLanguage() === 'hi';
const monthLong = (month: number) => (hindi() ? new Date(2000, month - 1, 1).toLocaleDateString(dateLocale(), { month: 'long' }) : MONTHS_LONG[month - 1]);
const dayMonth = (iso: string) =>
  hindi() ? new Date(`${iso}T00:00:00`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
const dayMonthYear = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;

/** The Monday of the week that contains `iso`. */
export const weekStartIso = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return shiftIsoDate(iso, -((weekday + 6) % 7));
};

export const presetRange = (preset: DatePreset, todayIso: string): DateRange => {
  const [year, month] = todayIso.split('-').map(Number);
  if (preset === 'week') {
    const from = weekStartIso(todayIso);
    const to = shiftIsoDate(from, 6);
    return { from, to, preset, label: t('This week · {0} to {1}', { 0: dayMonth(from), 1: dayMonth(to) }) };
  }
  if (preset === 'month') {
    return { ...monthBounds(year, month), preset, label: t('This month · {0}', { 0: monthLong(month) }) };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31`, preset, label: t('This year · {0}', { 0: year }) };
};

/** What the sheet shows beside each quick choice, e.g. "16 to 22 Nov". */
export const presetHint = (preset: DatePreset, todayIso: string): string => {
  const r = presetRange(preset, todayIso);
  return preset === 'week' ? t('{0} to {1}', { 0: dayMonth(r.from), 1: dayMonth(r.to) }) : preset === 'month' ? monthLong(Number(todayIso.slice(5, 7))) : todayIso.slice(0, 4);
};

/** Null when the pair is a usable range, otherwise what to tell the user. */
export const customRangeError = (from: string, to: string): string | null => {
  if (!isValidIsoDate(from)) return 'Enter the From date as YYYY-MM-DD, or pick it from the calendar.';
  if (!isValidIsoDate(to)) return 'Enter the To date as YYYY-MM-DD, or pick it from the calendar.';
  if (to < from) return "The To date can't be before the From date.";
  return null;
};

export const customRange = (from: string, to: string): DateRange => ({
  from,
  to,
  label: from === to ? dayMonthYear(from) : from.slice(0, 4) === to.slice(0, 4) ? t('{0} to {1}', { 0: dayMonth(from), 1: dayMonthYear(to) }) : t('{0} to {1}', { 0: dayMonthYear(from), 1: dayMonthYear(to) }),
});

/** Money in, money out and the difference for a range; the difference is negative when more went out. */
export const netOf = (income: number, expense: number): number => Math.round((income - expense) * 100) / 100;
