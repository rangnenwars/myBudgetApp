import { customRange, customRangeError, netOf, presetHint, presetRange, weekStartIso } from '../dateRanges';

describe('weekStartIso (weeks run Monday to Sunday)', () => {
  it('a Monday is its own week start', () => {
    expect(weekStartIso('2026-11-16')).toBe('2026-11-16');
  });
  it('a Sunday belongs to the week that began six days earlier', () => {
    expect(weekStartIso('2026-11-22')).toBe('2026-11-16');
  });
  it('midweek days map to that Monday', () => {
    for (const d of ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) expect(weekStartIso(d)).toBe('2026-11-16');
  });
  it('crosses month and year boundaries', () => {
    expect(weekStartIso('2026-12-02')).toBe('2026-11-30'); // Wednesday
    expect(weekStartIso('2027-01-01')).toBe('2026-12-28'); // Friday
  });
  it('a leap day', () => {
    expect(weekStartIso('2028-02-29')).toBe('2028-02-28'); // Tuesday
  });
});

describe('presetRange', () => {
  it('this week: Monday to Sunday, both included', () => {
    expect(presetRange('week', '2026-11-21')).toEqual({ from: '2026-11-16', to: '2026-11-22', preset: 'week', label: 'This week · 16 Nov to 22 Nov' });
  });
  it('this week across a month end', () => {
    const r = presetRange('week', '2026-12-02');
    expect(r.from).toBe('2026-11-30');
    expect(r.to).toBe('2026-12-06');
  });
  it('this month: first to last day', () => {
    expect(presetRange('month', '2026-11-21')).toMatchObject({ from: '2026-11-01', to: '2026-11-30', preset: 'month', label: 'This month · November' });
    expect(presetRange('month', '2028-02-10')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(presetRange('month', '2027-02-10')).toMatchObject({ to: '2027-02-28' });
  });
  it('this year: 1 January to 31 December', () => {
    expect(presetRange('year', '2026-11-21')).toEqual({ from: '2026-01-01', to: '2026-12-31', preset: 'year', label: 'This year · 2026' });
  });
  it('the first and the last day of the year give the same year', () => {
    expect(presetRange('year', '2026-01-01').from).toBe('2026-01-01');
    expect(presetRange('year', '2026-12-31').to).toBe('2026-12-31');
  });
});

describe('presetHint', () => {
  it('describes each quick choice for the sheet', () => {
    expect(presetHint('week', '2026-11-21')).toBe('16 Nov to 22 Nov');
    expect(presetHint('month', '2026-11-21')).toBe('November');
    expect(presetHint('year', '2026-11-21')).toBe('2026');
  });
});

describe('customRangeError', () => {
  it('accepts a normal range, a single day, and a whole year', () => {
    expect(customRangeError('2026-11-12', '2026-11-21')).toBeNull();
    expect(customRangeError('2026-11-12', '2026-11-12')).toBeNull();
    expect(customRangeError('2026-01-01', '2026-12-31')).toBeNull();
  });
  it('refuses a To before From', () => {
    expect(customRangeError('2026-11-21', '2026-11-20')).toMatch(/before the From/);
  });
  it.each(['', '2026-13-01', '2026-02-30', '12/11/2026', 'abc', '2026-1-5'])('refuses a From of %p', (from) => {
    expect(customRangeError(from, '2026-11-21')).toMatch(/From date/);
  });
  it.each(['', '2026-13-01', '2026-02-30', 'tomorrow'])('refuses a To of %p', (to) => {
    expect(customRangeError('2026-11-01', to)).toMatch(/To date/);
  });
  it('a leap day is valid only in a leap year', () => {
    expect(customRangeError('2028-02-29', '2028-03-01')).toBeNull();
    expect(customRangeError('2027-02-29', '2027-03-01')).toMatch(/From date/);
  });
});

describe('customRange labels', () => {
  it('same year: the year only at the end', () => {
    expect(customRange('2026-11-12', '2026-11-21').label).toBe('12 Nov to 21 Nov 2026');
  });
  it('different years: both years', () => {
    expect(customRange('2025-12-20', '2026-01-05').label).toBe('20 Dec 2025 to 5 Jan 2026');
  });
  it('one day', () => {
    expect(customRange('2026-11-12', '2026-11-12').label).toBe('12 Nov 2026');
  });
  it('keeps the dates it was given', () => {
    expect(customRange('2026-11-12', '2026-11-21')).toMatchObject({ from: '2026-11-12', to: '2026-11-21' });
  });
});

describe('netOf', () => {
  it('is money in minus money out, to the paisa', () => {
    expect(netOf(60000, 14250)).toBe(45750);
    expect(netOf(0.3, 0.1)).toBe(0.2);
    expect(netOf(100, 250.5)).toBe(-150.5);
    expect(netOf(0, 0)).toBe(0);
  });
});
