import { todayLocalIso, isValidIsoDate, shiftIsoDate, monthYearOf, entryDateError, shiftMonth, recentDateLabel } from '../dates';

describe('todayLocalIso', () => {
  it('uses the local calendar date, zero-padded', () => {
    expect(todayLocalIso(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
    expect(todayLocalIso(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});

describe('isValidIsoDate', () => {
  it('accepts real dates, including a leap day', () => {
    expect(isValidIsoDate('2026-10-03')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });
  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
  });
  it('rejects anything not in strict YYYY-MM-DD form', () => {
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate('2026-1-5')).toBe(false);
    expect(isValidIsoDate('03/10/2026')).toBe(false);
    expect(isValidIsoDate('2026-10-03 ')).toBe(false);
  });
});

describe('shiftIsoDate', () => {
  it('moves across month and year boundaries', () => {
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftIsoDate('2026-10-03', 0)).toBe('2026-10-03');
  });
  it('handles a leap-year February', () => {
    expect(shiftIsoDate('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('monthYearOf', () => {
  it('splits a date into month and year', () => {
    expect(monthYearOf('2026-10-03')).toEqual({ month: 10, year: 2026 });
  });
});

describe('entryDateError', () => {
  it('allows today and past dates', () => {
    expect(entryDateError('2026-10-03', '2026-10-03')).toBeNull();
    expect(entryDateError('2025-01-15', '2026-10-03')).toBeNull();
  });
  it('rejects a future date', () => {
    expect(entryDateError('2026-10-04', '2026-10-03')).toMatch(/future/);
  });
  it('rejects a malformed or impossible date', () => {
    expect(entryDateError('', '2026-10-03')).toMatch(/YYYY-MM-DD/);
    expect(entryDateError('2026-02-30', '2026-10-03')).toMatch(/YYYY-MM-DD/);
  });
});

describe('shiftMonth', () => {
  it('steps back and forward within a year', () => {
    expect(shiftMonth({ month: 10, year: 2026 }, -1)).toEqual({ month: 9, year: 2026 });
    expect(shiftMonth({ month: 10, year: 2026 }, 1)).toEqual({ month: 11, year: 2026 });
  });
  it('rolls over year boundaries in both directions', () => {
    expect(shiftMonth({ month: 1, year: 2026 }, -1)).toEqual({ month: 12, year: 2025 });
    expect(shiftMonth({ month: 12, year: 2026 }, 1)).toEqual({ month: 1, year: 2027 });
    expect(shiftMonth({ month: 3, year: 2026 }, -15)).toEqual({ month: 12, year: 2024 });
  });
});

describe('recentDateLabel', () => {
  it('says today and yesterday, and otherwise the day and month', () => {
    expect(recentDateLabel('2026-11-09', '2026-11-09')).toBe('today');
    expect(recentDateLabel('2026-11-08', '2026-11-09')).toBe('yesterday');
    expect(recentDateLabel('2026-11-07', '2026-11-09')).toBe('7 Nov');
  });

  it('handles yesterday across a month and year end', () => {
    expect(recentDateLabel('2026-10-31', '2026-11-01')).toBe('yesterday');
    expect(recentDateLabel('2025-12-31', '2026-01-01')).toBe('yesterday');
  });
});
