import { OTHERS_KEY, categoryRows, changePct, changeText, monthlyExpenseRows } from '../expenseReports';

const m = (month: number, expense: number, year = 2026) => ({ year, month, label: `M${month}`, expense });

describe('changePct', () => {
  it('rounds the change from the previous value', () => {
    expect(changePct(7400, 6600)).toBe(12);
    expect(changePct(6100, 6400)).toBe(-5);
    expect(changePct(500, 500)).toBe(0);
  });

  it('has no value when there is nothing to compare with', () => {
    expect(changePct(500, 0)).toBeNull();
    expect(changePct(500, null)).toBeNull();
    expect(changePct(0, 0)).toBeNull();
  });

  it('writes the sign', () => {
    expect(changeText(12)).toBe('+12%');
    expect(changeText(-5)).toBe('-5%');
    expect(changeText(0)).toBe('0%');
  });
});

describe('monthlyExpenseRows', () => {
  // Sep is the baseline; Oct and Nov are listed.
  const series = [m(9, 6000), m(10, 6600), m(11, 7400)];

  it('lists months newest first with the change against the month before', () => {
    const { rows } = monthlyExpenseRows(series);
    expect(rows.map((r) => r.month)).toEqual([11, 10]);
    expect(rows.map((r) => r.changePct)).toEqual([12, 10]);
  });

  it('finds the average and the highest month over the months listed', () => {
    const { average, highest } = monthlyExpenseRows(series);
    expect(average).toBe(7000);
    expect(highest?.month).toBe(11);
  });

  it('scales bars to the highest month', () => {
    const { rows } = monthlyExpenseRows(series);
    expect(rows[0].barPct).toBe(100);
    expect(rows[1].barPct).toBeCloseTo((6600 / 7400) * 100);
  });

  it('keeps months with no expenses as 0 and hides the change after one', () => {
    const { rows } = monthlyExpenseRows([m(8, 5000), m(9, 0), m(10, 4000)]);
    expect(rows.map((r) => [r.month, r.total, r.changePct])).toEqual([
      [10, 4000, null],
      [9, 0, -100],
    ]);
  });

  it('copes with no spending at all', () => {
    const { rows, average, highest } = monthlyExpenseRows([m(9, 0), m(10, 0), m(11, 0)]);
    expect(rows.every((r) => r.total === 0 && r.barPct === 0 && r.changePct === null)).toBe(true);
    expect(average).toBe(0);
    expect(highest).toBeNull();
  });

  it('can list every month when the series has no baseline', () => {
    const { rows } = monthlyExpenseRows([m(10, 100), m(11, 150)], false);
    expect(rows.map((r) => [r.month, r.changePct])).toEqual([[11, 50], [10, null]]);
  });
});

describe('categoryRows', () => {
  const cur = [
    { category: 'food', total: 2900 },
    { category: 'travel', total: 1600 },
    { category: 'recharge', total: 800 },
    { category: 'misc_a', total: 1200 },
    { category: 'misc_b', total: 900 },
  ];
  const known = () => true;

  it('adds up to the period total, folding the smallest into Others', () => {
    const { total, rows } = categoryRows(cur, null, 3, known);
    expect(total).toBe(7400);
    expect(rows.map((r) => r.category)).toEqual(['food', 'travel', 'misc_a', OTHERS_KEY]);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(total);
    expect(rows[3].total).toBe(1700);
  });

  it('works out shares and bars', () => {
    const { rows } = categoryRows(cur, null, 3, known);
    expect(rows[0].sharePct).toBe(39);
    expect(rows[0].barPct).toBe(100);
    expect(rows.every((r) => r.changePct === null)).toBe(true);
  });

  it('puts categories the app does not know under Others, even a big one', () => {
    const { rows } = categoryRows([{ category: 'gone', total: 5000 }, { category: 'food', total: 100 }], null, 3, (c) => c !== 'gone');
    expect(rows.map((r) => [r.category, r.total])).toEqual([['food', 100], [OTHERS_KEY, 5000]]);
  });

  it('compares each row with the previous period, Others included', () => {
    const prev = [
      { category: 'food', total: 2458 },
      { category: 'travel', total: 1667 },
      { category: 'misc_a', total: 1200 },
      { category: 'misc_b', total: 400 },
      { category: 'recharge', total: 400 },
    ];
    const { rows } = categoryRows(cur, prev, 3, known);
    expect(rows.map((r) => r.changePct)).toEqual([18, -4, 0, 113]);
  });

  it('has no change for a category that had nothing before', () => {
    const { rows } = categoryRows([{ category: 'food', total: 100 }], [{ category: 'travel', total: 50 }], 3, known);
    expect(rows[0].changePct).toBeNull();
  });

  it('is empty for a period with no expenses', () => {
    expect(categoryRows([], [], 3, known)).toEqual({ total: 0, rows: [] });
  });
});
