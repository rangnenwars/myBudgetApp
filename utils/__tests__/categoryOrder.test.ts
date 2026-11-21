import { barPercent, categoryBlockTitle, parseCategoryOrder, pickCategories } from '../categoryOrder';

const rows = [
  { category: 'rent', total: 15000 },
  { category: 'groceries', total: 8400 },
  { category: 'fuel', total: 3200 },
  { category: 'internet', total: 999 },
  { category: 'recharge', total: 299 },
  { category: 'stationery', total: 120 },
  { category: 'fun', total: 0 },
];

describe('pickCategories', () => {
  it('highest: the five biggest, biggest first', () => {
    expect(pickCategories(rows, 'highest').map((r) => r.category)).toEqual(['rent', 'groceries', 'fuel', 'internet', 'recharge']);
  });

  it('lowest: the five smallest that have spending, smallest first, leaving out zero', () => {
    expect(pickCategories(rows, 'lowest').map((r) => r.category)).toEqual(['stationery', 'recharge', 'internet', 'fuel', 'groceries']);
  });

  it('fewer than five categories: shows them all, in the chosen order', () => {
    const two = rows.slice(0, 2);
    expect(pickCategories(two, 'highest').map((r) => r.category)).toEqual(['rent', 'groceries']);
    expect(pickCategories(two, 'lowest').map((r) => r.category)).toEqual(['groceries', 'rent']);
  });

  it('no spending at all gives an empty list in both orders', () => {
    expect(pickCategories([], 'highest')).toEqual([]);
    expect(pickCategories([{ category: 'fun', total: 0 }], 'lowest')).toEqual([]);
  });

  it('ties keep a steady order by category key', () => {
    const tied = [
      { category: 'b', total: 100 },
      { category: 'a', total: 100 },
      { category: 'c', total: 100 },
    ];
    expect(pickCategories(tied, 'highest').map((r) => r.category)).toEqual(['a', 'b', 'c']);
    expect(pickCategories(tied, 'lowest').map((r) => r.category)).toEqual(['a', 'b', 'c']);
  });

  it('does not change the list it is given', () => {
    const copy = rows.map((r) => ({ ...r }));
    pickCategories(rows, 'lowest');
    expect(rows).toEqual(copy);
  });

  it('keeps extra fields on each row', () => {
    const out = pickCategories([{ category: 'rent', total: 5, icon: 'x' }], 'highest');
    expect(out[0].icon).toBe('x');
  });

  it('a limit of three', () => {
    expect(pickCategories(rows, 'lowest', 3).map((r) => r.category)).toEqual(['stationery', 'recharge', 'internet']);
  });
});

describe('barPercent', () => {
  it('is measured against the month\'s biggest category', () => {
    expect(barPercent(15000, 15000)).toBe(100);
    expect(barPercent(7500, 15000)).toBe(50);
    expect(barPercent(120, 15000)).toBeCloseTo(0.8, 5);
  });
  it('never goes outside 0 to 100, and a zero biggest gives 0', () => {
    expect(barPercent(20000, 15000)).toBe(100);
    expect(barPercent(-5, 15000)).toBe(0);
    expect(barPercent(10, 0)).toBe(0);
  });
});

describe('title and saved choice', () => {
  it('names the block after what it shows', () => {
    expect(categoryBlockTitle('highest')).toBe('Top expense categories');
    expect(categoryBlockTitle('lowest')).toBe('Smallest expense categories');
  });
  it('anything unknown or missing is the default, highest', () => {
    expect(parseCategoryOrder('lowest')).toBe('lowest');
    expect(parseCategoryOrder('highest')).toBe('highest');
    expect(parseCategoryOrder(null)).toBe('highest');
    expect(parseCategoryOrder('sideways')).toBe('highest');
    expect(parseCategoryOrder(undefined)).toBe('highest');
  });
});
