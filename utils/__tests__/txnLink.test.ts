import { filterFromParams, monthBounds, monthFilter, rangeBounds, txnLink } from '../txnLink';

describe('txnLink', () => {
  it('finds a month\'s first and last day, including leap February', () => {
    expect(monthBounds(2026, 10)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthBounds(2028, 2).to).toBe('2028-02-29');
    expect(monthBounds(2026, 2).to).toBe('2026-02-28');
  });

  it('spans a range of months and labels it', () => {
    expect(rangeBounds(5, 2026, 10, 2026)).toEqual({ from: '2026-05-01', to: '2026-10-31', label: 'May 2026 to Oct 2026' });
    expect(rangeBounds(10, 2026, 10, 2026).label).toBe('Oct 2026');
  });

  it('builds the link with only the filters that were given', () => {
    const link = txnLink({ type: 'expense', category: 'food', ...monthFilter(2026, 10) }, 123);
    expect(link.pathname).toBe('/(tabs)/transactions');
    expect(link.params).toEqual({ type: 'expense', category: 'food', from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026', n: '123' });
    expect(txnLink({ type: 'income' }, 1).params).toEqual({ type: 'income', n: '1' });
  });

  it('reads the filters back, and treats a plain open as no filter', () => {
    expect(filterFromParams({})).toBeNull();
    expect(filterFromParams({ n: '5', type: 'income', category: 'salary_1', from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026' })).toEqual({
      n: '5', type: 'income', category: 'salary_1', from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026',
    });
    expect(filterFromParams({ n: '5', type: 'bogus' })?.type).toBeUndefined();
    expect(filterFromParams({ n: ['7', '8'], category: ['x'] })).toMatchObject({ n: '7', category: 'x' });
  });
});
