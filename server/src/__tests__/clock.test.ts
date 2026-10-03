import { localToday, addMonths } from '../lib/clock';

describe('localToday', () => {
  const saved = process.env.APP_TIMEZONE;
  afterEach(() => {
    process.env.APP_TIMEZONE = saved;
  });

  it('uses India time by default: 1 Oct 00:30 IST is still 30 Sep in UTC', () => {
    delete process.env.APP_TIMEZONE;
    const instant = new Date('2026-09-30T19:00:00Z'); // 1 Oct 2026, 00:30 IST
    expect(localToday(instant)).toEqual({ year: 2026, month: 10, day: 1, iso: '2026-10-01' });
    process.env.APP_TIMEZONE = 'UTC';
    expect(localToday(instant).iso).toBe('2026-09-30');
  });

  it('rolls the year over at 31 Dec in the app time zone', () => {
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    expect(localToday(new Date('2026-12-31T18:30:00Z')).iso).toBe('2027-01-01');
  });
});

describe('addMonths', () => {
  it('moves across year boundaries both ways', () => {
    expect(addMonths(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
    expect(addMonths(2026, 1, -2)).toEqual({ year: 2025, month: 11 });
  });
});
