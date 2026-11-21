// SIP (a fixed amount invested every month) on an investment. The server adds it to Transactions on
// the SIP day each month and raises the investment by the same amount, the way it already does for
// loan EMIs. These are the pure date rules, shared by the server and the app.

/** The categories a SIP can be added to Transactions under: the investment categories. */
export const SIP_CATEGORIES = ['mutual_funds', 'fixed_deposit', 'bonds', 'gold'] as const;
export type SipCategory = (typeof SIP_CATEGORIES)[number];
export const DEFAULT_SIP_CATEGORY: SipCategory = 'mutual_funds';

/** What the app sends to start a SIP. `no_end` or `ends_on`, one of the two. */
export interface SipInput {
  amount: number;
  day: number;
  category: SipCategory;
  ends_on?: string | null;
  no_end?: boolean;
}

/** A missed stretch longer than this is not backfilled (the same cap as loan EMIs). */
export const MAX_SIP_CATCH_UP_MONTHS = 24;

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** First day of a month, YYYY-MM-DD. */
export const sipMonthStart = (year: number, month: number): string => `${year}-${pad(month)}-01`;

/** The day a SIP lands in a month: the 29th to 31st fall back to the month's last day. */
export const sipPostingDate = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(Math.min(day, daysIn(year, month)))}`;

const afterMonth = (year: number, month: number): { year: number; month: number } => (month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 });

export interface SipMonth {
  year: number;
  month: number;
  /** The day it lands that month, YYYY-MM-DD. */
  date: string;
  /** False when the SIP had already ended by that day: the month is settled but nothing is added. */
  post: boolean;
}

/**
 * The months still to settle, oldest first. `through` is the first day of the last month already
 * settled, or null for a SIP never posted: that one starts this month, with no backfilled history.
 * A month is only listed once its SIP day has arrived, so nothing is ever dated in the future.
 */
export const sipMonthsDue = (through: string | null, day: number, endsOn: string | null, todayIso: string, maxMonths: number = MAX_SIP_CATCH_UP_MONTHS): SipMonth[] => {
  const [cy, cm] = todayIso.split('-').map(Number);
  let y = cy;
  let m = cm;
  if (through) {
    const start = afterMonth(Number(through.slice(0, 4)), Number(through.slice(5, 7)));
    y = start.year;
    m = start.month;
  }
  const months: SipMonth[] = [];
  while (y < cy || (y === cy && m <= cm)) {
    const date = sipPostingDate(y, m, day);
    if (date > todayIso) break;
    months.push({ year: y, month: m, date, post: !(endsOn && date > endsOn) });
    const next = afterMonth(y, m);
    y = next.year;
    m = next.month;
  }
  return months.slice(-maxMonths);
};

/** The date of the next SIP not yet added, or null once the SIP has ended. */
export const nextSipDate = (through: string | null, day: number, endsOn: string | null, todayIso: string): string | null => {
  let year: number;
  let month: number;
  if (through) {
    const n = afterMonth(Number(through.slice(0, 4)), Number(through.slice(5, 7)));
    year = n.year;
    month = n.month;
  } else {
    [year, month] = todayIso.split('-').map(Number);
  }
  const date = sipPostingDate(year, month, day);
  return endsOn && date > endsOn ? null : date;
};

/** "1st", "2nd", "3rd", "11th"… for the day of the month. */
export const ordinalDay = (n: number): string => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
};

/** The investment after one SIP: invested and value both go up by the amount, and the gain % is worked out again. */
export const applySip = (amount: number, currentValue: number | null, sip: number): { amount: number; current_value: number | null; returns_percent: number } => {
  const invested = Math.round((amount + sip) * 100) / 100;
  const value = currentValue == null ? null : Math.round((currentValue + sip) * 100) / 100;
  const shown = value ?? invested;
  return { amount: invested, current_value: value, returns_percent: invested > 0 ? ((shown - invested) / invested) * 100 : 0 };
};
