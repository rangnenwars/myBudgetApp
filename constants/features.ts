// Features an admin switches on or off per user. Shared by the client (which
// tabs to show) and the server (which routes to allow), so the list can't
// drift between the two. Everything not listed here — Home, Transactions,
// Reports, Budgets, Accounts, Input expenses, People — is always on.

export const FEATURES = [
  { key: 'goals', label: 'Goals', description: 'Save towards a phone, a trip or an emergency fund' },
  { key: 'loans', label: 'Loans', description: 'Track EMIs, part payments and the payoff date' },
  { key: 'investments', label: 'Investments', description: 'Mutual funds, FDs, gold and chit funds' },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];

export const FEATURE_KEYS = FEATURES.map((f) => f.key) as [FeatureKey, ...FeatureKey[]];

export const featureLabel = (key: FeatureKey): string => FEATURES.find((f) => f.key === key)!.label;
