// Home's expense-category block: the five biggest categories this month, or the five smallest.

export type CategoryOrder = 'highest' | 'lowest';

export const CATEGORY_LIMIT = 5;

/**
 * 'highest': the biggest `limit` categories, biggest first.
 * 'lowest': the smallest `limit` categories that have any spending, smallest first
 * (a category with nothing spent is not an expense category this month).
 * Ties keep a steady order by category key, so the list does not jump between loads.
 */
export const pickCategories = <T extends { category: string; total: number }>(rows: readonly T[], order: CategoryOrder, limit: number = CATEGORY_LIMIT): T[] => {
  const byKey = (a: T, b: T) => a.category.localeCompare(b.category);
  const spent = rows.filter((r) => r.total > 0);
  const sorted = [...spent].sort((a, b) => (order === 'highest' ? b.total - a.total : a.total - b.total) || byKey(a, b));
  return sorted.slice(0, limit);
};

/** Bar length (0 to 100) against the biggest category of the month, so a small category looks small in either order. */
export const barPercent = (total: number, biggest: number): number => (biggest > 0 ? Math.max(0, Math.min(100, (total / biggest) * 100)) : 0);

export const categoryBlockTitle = (order: CategoryOrder): string => (order === 'highest' ? 'Top expense categories' : 'Smallest expense categories');

export const parseCategoryOrder = (value: unknown): CategoryOrder => (value === 'lowest' ? 'lowest' : 'highest');
