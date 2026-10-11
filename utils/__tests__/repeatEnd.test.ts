import { addMonthsToIso, endPayload, endStatus, endsOnFor, firstRepeatDate, repeatEndError, repeatPreview } from '../repeatEnd';

describe('repeat end date', () => {
  it('counts presets from the base date, clamping to short months', () => {
    expect(endsOnFor('2026-10-05', { kind: 'months', months: 12 })).toBe('2027-10-05');
    expect(addMonthsToIso('2026-08-31', 6)).toBe('2027-02-28');
    expect(endsOnFor('2026-10-05', { kind: 'none' })).toBeNull();
    expect(endsOnFor('2026-10-05', { kind: 'date', date: '2026-02-30' })).toBeNull();
  });

  it('previews the entries a repeat adds', () => {
    // 12 months of a monthly rule started on 5 Oct: first 5 Nov, last 5 Oct next year.
    const p = repeatPreview(firstRepeatDate('2026-10-05', 'monthly'), 'monthly', 5, '2027-10-05');
    expect(p).toEqual({ count: 12, first: '2026-11-05', last: '2027-10-05' });
  });

  it('leaves out the last month when the repeat day falls after the end date', () => {
    const p = repeatPreview('2026-02-25', 'monthly', 25, '2026-07-20');
    expect(p.last).toBe('2026-06-25');
    expect(p.count).toBe(5);
  });

  it('handles quarterly, yearly and an end before the first entry', () => {
    expect(repeatPreview(firstRepeatDate('2026-01-31', 'quarterly'), 'quarterly', 31, '2026-12-31')).toEqual({ count: 3, first: '2026-04-30', last: '2026-10-31' });
    expect(repeatPreview(firstRepeatDate('2026-03-14', 'yearly'), 'yearly', 14, '2026-12-31').count).toBe(0);
  });

  it('requires a choice and a usable date', () => {
    expect(repeatEndError('2026-10-05', null)).toMatch(/choose/i);
    expect(repeatEndError('2026-10-05', { kind: 'date', date: '2026-1' })).toMatch(/YYYY-MM-DD/);
    expect(repeatEndError('2026-10-05', { kind: 'date', date: '2026-10-04' })).toMatch(/before/);
    expect(repeatEndError('2026-10-05', { kind: 'none' })).toBeNull();
    expect(repeatEndError('2026-10-05', { kind: 'months', months: 3 })).toBeNull();
  });

  it('builds the request fields', () => {
    expect(endPayload('2026-10-05', { kind: 'months', months: 6 })).toEqual({ ends_on: '2027-04-05' });
    expect(endPayload('2026-10-05', { kind: 'none' })).toEqual({ no_end: true });
  });

  it('labels a rule by its end', () => {
    expect(endStatus({ ends_on: null, no_end: false }, '2026-10-11')).toEqual({ text: 'needs an end date', warn: true });
    expect(endStatus({ ends_on: null, no_end: true }, '2026-10-11')).toEqual({ text: 'no end date', warn: false });
    expect(endStatus({ ends_on: '2026-10-23', no_end: false }, '2026-10-11')).toEqual({ text: 'ends in 12 days', warn: true });
    expect(endStatus({ ends_on: '2027-10-05', no_end: false }, '2026-10-11').warn).toBe(false);
  });
});
