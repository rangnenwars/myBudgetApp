import { MAX_SIP_CATCH_UP_MONTHS, SIP_CATEGORIES, applySip, nextSipDate, ordinalDay, sipMonthStart, sipMonthsDue, sipPostingDate } from '../sip';

describe('sipPostingDate', () => {
  it('lands on the chosen day', () => {
    expect(sipPostingDate(2026, 12, 5)).toBe('2026-12-05');
    expect(sipPostingDate(2026, 12, 1)).toBe('2026-12-01');
  });
  it('the 29th to 31st fall back to the last day of a shorter month', () => {
    expect(sipPostingDate(2026, 11, 31)).toBe('2026-11-30');
    expect(sipPostingDate(2026, 2, 30)).toBe('2026-02-28');
    expect(sipPostingDate(2028, 2, 30)).toBe('2028-02-29'); // leap year
    expect(sipPostingDate(2026, 12, 31)).toBe('2026-12-31');
  });
  it('month start', () => {
    expect(sipMonthStart(2026, 3)).toBe('2026-03-01');
  });
});

describe('sipMonthsDue', () => {
  const dates = (months: { date: string }[]) => months.map((m) => m.date);

  it('a SIP never posted starts this month, once its day has arrived', () => {
    expect(dates(sipMonthsDue(null, 5, null, '2026-11-21'))).toEqual(['2026-11-05']);
    expect(dates(sipMonthsDue(null, 21, null, '2026-11-21'))).toEqual(['2026-11-21']);
  });
  it('nothing yet while this month\'s day has not arrived: never dated in the future', () => {
    expect(sipMonthsDue(null, 22, null, '2026-11-21')).toEqual([]);
    expect(sipMonthsDue('2026-10-01', 22, null, '2026-11-21')).toEqual([]);
  });
  it('after a month is settled, the next one is due only on its day', () => {
    expect(sipMonthsDue('2026-11-01', 5, null, '2026-12-04')).toEqual([]);
    expect(dates(sipMonthsDue('2026-11-01', 5, null, '2026-12-05'))).toEqual(['2026-12-05']);
  });
  it('catches up every missed month, oldest first', () => {
    expect(dates(sipMonthsDue('2026-08-01', 5, null, '2026-11-21'))).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
  });
  it('catch-up crosses a year end', () => {
    expect(dates(sipMonthsDue('2026-11-01', 15, null, '2027-02-20'))).toEqual(['2026-12-15', '2027-01-15', '2027-02-15']);
  });
  it('a day of 31 uses the last day of shorter months', () => {
    expect(dates(sipMonthsDue('2026-09-01', 31, null, '2026-12-31'))).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
    expect(sipMonthsDue('2026-10-01', 31, null, '2026-11-29')).toEqual([]);
    expect(dates(sipMonthsDue('2026-10-01', 31, null, '2026-11-30'))).toEqual(['2026-11-30']);
  });
  it('months after the end date are settled but add nothing', () => {
    const months = sipMonthsDue('2026-08-01', 5, '2026-10-05', '2026-12-10');
    expect(months.map((m) => [m.date, m.post])).toEqual([
      ['2026-09-05', true],
      ['2026-10-05', true], // the end date itself is included
      ['2026-11-05', false],
      ['2026-12-05', false],
    ]);
  });
  it('an end date earlier than the first day adds nothing at all', () => {
    expect(sipMonthsDue(null, 5, '2026-10-31', '2026-11-21').map((m) => m.post)).toEqual([false]);
  });
  it('a long gap is capped at the most recent months', () => {
    const months = sipMonthsDue('2020-01-01', 1, null, '2026-11-21');
    expect(months).toHaveLength(MAX_SIP_CATCH_UP_MONTHS);
    expect(months[months.length - 1].date).toBe('2026-11-01');
  });
  it('a settled month in the future of today lists nothing', () => {
    expect(sipMonthsDue('2027-01-01', 5, null, '2026-11-21')).toEqual([]);
  });
});

describe('nextSipDate', () => {
  it('a new SIP: this month if it has not passed, otherwise it is due now', () => {
    expect(nextSipDate(null, 25, null, '2026-11-21')).toBe('2026-11-25');
    expect(nextSipDate(null, 5, null, '2026-11-21')).toBe('2026-11-05');
  });
  it('after a month is settled, the following month', () => {
    expect(nextSipDate('2026-11-01', 5, null, '2026-11-21')).toBe('2026-12-05');
    expect(nextSipDate('2026-12-01', 5, null, '2026-12-21')).toBe('2027-01-05');
  });
  it('is null once the SIP has ended', () => {
    expect(nextSipDate('2026-11-01', 5, '2026-11-30', '2026-11-21')).toBeNull();
    expect(nextSipDate('2026-11-01', 5, '2026-12-05', '2026-11-21')).toBe('2026-12-05');
  });
  it('short months', () => {
    expect(nextSipDate('2026-01-01', 31, null, '2026-01-31')).toBe('2026-02-28');
  });
});

describe('ordinalDay', () => {
  it.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [30, '30th'], [31, '31st']])('%s', (n, text) => {
    expect(ordinalDay(n)).toBe(text);
  });
});

describe('applySip', () => {
  it('raises invested and value by the SIP, and works out the gain again', () => {
    const r = applySip(120000, 138000, 5000);
    expect(r.amount).toBe(125000);
    expect(r.current_value).toBe(143000);
    expect(r.returns_percent).toBeCloseTo(14.4, 6);
  });
  it('with no value saved, the gain stays at zero', () => {
    expect(applySip(10000, null, 500)).toEqual({ amount: 10500, current_value: null, returns_percent: 0 });
  });
  it('adds to the paisa with no float drift', () => {
    expect(applySip(0.1, 0.1, 0.2).amount).toBe(0.3);
    expect(applySip(0.1, 0.1, 0.2).current_value).toBe(0.3);
  });
  it('a loss stays a loss', () => {
    const r = applySip(1000, 800, 100);
    expect(r.amount).toBe(1100);
    expect(r.current_value).toBe(900);
    expect(r.returns_percent).toBeCloseTo(-18.18, 1);
  });
});

describe('SIP_CATEGORIES', () => {
  it('are the four investment categories', () => {
    expect([...SIP_CATEGORIES]).toEqual(['mutual_funds', 'fixed_deposit', 'bonds', 'gold']);
  });
});
