// Tests compute "this month" in UTC (see recurring/loans tests), so pin the
// app time zone to UTC unless a run sets it; clock.test.ts covers IST itself.
process.env.APP_TIMEZONE ??= 'UTC';

// Every Jest worker opens its own connection pool to the one test database.
// With the default of 10 each, a few dozen test files in parallel run Postgres
// out of connections ("too many clients already"). A test file needs only a few.
process.env.PG_POOL_MAX ??= '3';
