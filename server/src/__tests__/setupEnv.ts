// Tests compute "this month" in UTC (see recurring/loans tests), so pin the
// app time zone to UTC unless a run sets it; clock.test.ts covers IST itself.
process.env.APP_TIMEZONE ??= 'UTC';
