// The first-time tour: a welcome, a walk round everything on Home (each item is highlighted on the real
// screen with an arrow and a short message), a quick word on the other pages, and a last card. Shown after
// sign-up with a Skip button; it can be replayed from Settings. Steps whose item is not on screen for this
// person (a feature switched off, no free-money card this month) are left out when the tour starts.
// The text is English here and goes through the translation layer when it is drawn.

export interface TourStep {
  key: string;
  /** An Ionicons name, for the centred card. */
  icon: string;
  title: string;
  body: string;
  /** Name of the Home item to highlight (see TourTarget). No target means a centred card. */
  target?: string;
  /** Left out when its target is not on screen. Without this, a missing target shows a centred card instead. */
  optional?: boolean;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { key: 'welcome', icon: 'sparkles-outline', title: 'Welcome to Prapanji', body: 'A short tour: first everything on Home, then a word on the other pages. You can skip it and find it again in Settings.' },

  // Home, top to bottom
  { key: 'header', icon: 'calendar-outline', target: 'home-header', title: 'Your month', body: 'Your name and the month you are looking at. Tap the arrows to see an earlier month.' },
  { key: 'settings', icon: 'settings-outline', target: 'home-settings', title: 'Settings', body: 'Language, privacy and sign-in history, and this tour again.' },
  { key: 'add', icon: 'add-circle-outline', target: 'home-add', title: 'Add a spend in seconds', body: 'Tap the orange + button, type the amount and pick a category. That is all.' },
  { key: 'month', icon: 'home-outline', target: 'home-month', title: 'This month', body: 'What you have spent so far, and how that compares with last month. Set a monthly budget here.' },
  { key: 'money', icon: 'cash-outline', target: 'home-money', optional: true, title: 'Money left after fixed bills', body: 'What is yours to spend this month after EMIs and repeating bills, and about how much that is a day.' },
  { key: 'people', icon: 'people-outline', target: 'home-people', title: 'People and Accounts', body: 'Split bills and track money you lend or borrow, and keep your bank, cash and wallet balances.' },
  { key: 'summary', icon: 'stats-chart-outline', target: 'home-summary', title: 'Income, expense and savings', body: 'Your income and expenses for the month, and what you saved. Tap income or expense to see the entries.' },
  { key: 'categories', icon: 'pie-chart-outline', target: 'home-categories', title: 'Where the money goes', body: 'Your top spending categories. Switch between Highest and Lowest, or tap All categories to open Reports.' },
  { key: 'recent', icon: 'time-outline', target: 'home-recent', optional: true, title: 'Recent transactions', body: 'Your latest entries. Tap See all, or any entry to open it.' },
  { key: 'insights', icon: 'bulb-outline', target: 'home-insights', title: 'Insights', body: 'Your savings rate and how each category changed from last month.' },
  { key: 'more', icon: 'apps-outline', target: 'home-more', optional: true, title: 'More features', body: 'Budgets, planning ahead and other tools live here. Open it to see what else the app can do.' },

  // The other pages, from the tab bar
  { key: 'transactions', icon: 'swap-horizontal-outline', target: 'tab-transactions', title: 'Transactions', body: 'Every entry in one place. Search, filter by dates, edit, delete, and make an entry repeat.' },
  { key: 'loans', icon: 'card-outline', target: 'tab-loans', optional: true, title: 'Loans', body: 'Track EMIs and part payments, and see how soon you will be done with them.' },
  { key: 'investments', icon: 'trending-up-outline', target: 'tab-investments', optional: true, title: 'Investments', body: 'Keep your investments in one place, including a monthly SIP that adds itself to Transactions.' },
  { key: 'goals', icon: 'flag-outline', target: 'tab-goals', optional: true, title: 'Goals', body: 'Save towards something and see when you will get there.' },
  { key: 'reports', icon: 'bar-chart-outline', target: 'tab-reports', title: 'Reports', body: 'Charts and totals: an overview, month by month, and categories for both expenses and income.' },

  { key: 'ready', icon: 'checkmark-circle-outline', title: "You're ready", body: 'Add your first spend and watch Home fill in. Find any entry later with Search and Dates in Transactions. You can open this tour again from Settings.' },
];

/** The steps this person will see: those whose item is on screen, plus every step that does not need one. */
export const stepsFor = (hasTarget: (id: string) => boolean, steps: readonly TourStep[] = TOUR_STEPS): TourStep[] =>
  steps.filter((s) => !s.target || !s.optional || hasTarget(s.target));

/** The most the server accepts as a step number (see routes/tour.ts). */
export const MAX_STEPS = 20;

/** Where to go from a card: the first has no Back, the last has no Next; Skip on all but the last. */
export const stepButtons = (index: number, length: number): { back: boolean; next: boolean; skip: boolean } => ({
  back: index > 0 && index < length - 1,
  next: index < length - 1,
  skip: index < length - 1,
});

export const clampStep = (index: number, length: number = TOUR_STEPS.length): number => Math.max(0, Math.min(length - 1, Math.trunc(index) || 0));
