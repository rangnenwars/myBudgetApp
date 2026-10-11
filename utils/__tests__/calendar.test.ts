import { addMonthsTo, isoOf, monthCells, monthOutOfRange, outOfRange } from '../calendar';

describe('calendar helpers', () => {
  it('lays a month out Monday-first', () => {
    // 1 Oct 2026 is a Thursday: three blanks, then 31 days.
    const cells = monthCells(2026, 10);
    expect(cells.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(cells.filter((c) => c != null)).toHaveLength(31);
    // 1 Jun 2026 is a Monday: no blanks. Leap February has 29 days.
    expect(monthCells(2026, 6)[0]).toBe(1);
    expect(monthCells(2028, 2).filter((c) => c != null)).toHaveLength(29);
    // 1 Feb 2026 is a Sunday: six blanks.
    expect(monthCells(2026, 2).slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
  });

  it('applies min and max inclusively', () => {
    expect(outOfRange('2026-10-12', undefined, '2026-10-11')).toBe(true);
    expect(outOfRange('2026-10-11', undefined, '2026-10-11')).toBe(false);
    expect(outOfRange('2026-10-10', '2026-10-11')).toBe(true);
    expect(outOfRange('2026-10-11', '2026-10-11')).toBe(false);
    expect(outOfRange('1999-01-01')).toBe(false);
  });

  it('greys a month only when no day in it can be picked', () => {
    expect(monthOutOfRange(2026, 11, undefined, '2026-10-11')).toBe(true);
    expect(monthOutOfRange(2026, 10, undefined, '2026-10-11')).toBe(false);
    expect(monthOutOfRange(2026, 9, '2026-10-11')).toBe(true);
    expect(monthOutOfRange(2026, 10, '2026-10-11')).toBe(false);
  });

  it('moves between months across years', () => {
    expect(addMonthsTo(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonthsTo(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonthsTo(2026, 5, 12)).toEqual({ year: 2027, month: 5 });
    expect(isoOf(2026, 3, 4)).toBe('2026-03-04');
  });
});
