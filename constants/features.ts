// Features an admin switches on or off per user. Shared by the client (which
// tabs to show) and the server (which routes to allow), so the list can't
// drift between the two. Everything not listed here — Home, Transactions,
// Reports, Budgets, Accounts, Input expenses, People — is always on.

// price is in rupees for one `period`; 0 means free for now (users still ask an admin).
export type FeaturePeriod = 'month' | 'year';

export const FEATURES = [
  { key: 'goals', label: 'Goals', description: 'Save towards a phone, a trip or an emergency fund', price: 0, period: 'month' },
  { key: 'loans', label: 'Loans', description: 'Track EMIs, part payments and the payoff date', price: 0, period: 'month' },
  { key: 'investments', label: 'Investments', description: 'Mutual funds, FDs, gold and chit funds', price: 0, period: 'month' },
  { key: 'forecast', label: 'Plan ahead', description: 'See the next 12 months from your repeating income, bills and loans', price: 0, period: 'month' },
] as const satisfies readonly { key: string; label: string; description: string; price: number; period: FeaturePeriod }[];

export type FeatureKey = (typeof FEATURES)[number]['key'];

export const FEATURE_KEYS = FEATURES.map((f) => f.key) as [FeatureKey, ...FeatureKey[]];

export const featureLabel = (key: FeatureKey): string => FEATURES.find((f) => f.key === key)!.label;

export const featurePrice = (key: FeatureKey): { price: number; period: FeaturePeriod } => {
  const f = FEATURES.find((x) => x.key === key)!;
  return { price: f.price, period: f.period };
};

/** "₹49 / month", or "Free for now". */
export const priceLabel = (price: number, period: FeaturePeriod): string => (price > 0 ? `₹${price} / ${period}` : 'Free for now');
