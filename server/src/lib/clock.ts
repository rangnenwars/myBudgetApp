// "What day/month is it?" for the app's users, not for the server's clock.
// The server (Docker, cloud VM) usually runs in UTC, but the users are in
// India: between 00:00 and 05:30 IST the UTC date is still yesterday, so a
// month that began for the user hadn't begun for the server. Every
// month-boundary decision (EMI and repeating-entry posting, budget month,
// budget class, net-worth snapshot) goes through here instead.
// APP_TIMEZONE overrides the zone (IANA name); read per call so tests can set it.

export const appTimeZone = (): string => process.env.APP_TIMEZONE || 'Asia/Kolkata';

const pad = (n: number) => String(n).padStart(2, '0');

export interface LocalDate {
  year: number;
  month: number; // 1–12
  day: number;
  /** YYYY-MM-DD */
  iso: string;
}

/** Today's calendar date in the app time zone. */
export const localToday = (now: Date = new Date()): LocalDate => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return { year, month, day, iso: `${year}-${pad(month)}-${pad(day)}` };
};


/**
 * Half-open date range [from, toExclusive) covering months start..end
 * inclusive, as YYYY-MM-DD strings — how every "transactions in month X"
 * query filters, so it can use idx_transactions_user_date.
 */
export const monthsDateRange = (startYear: number, startMonth: number, endYear = startYear, endMonth = startMonth) => {
  const after = addMonths(endYear, endMonth, 1);
  return { from: `${startYear}-${pad(startMonth)}-01`, toExclusive: `${after.year}-${pad(after.month)}-01` };
};

/** The month `delta` months from (year, month), rolling over years. */
export const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
