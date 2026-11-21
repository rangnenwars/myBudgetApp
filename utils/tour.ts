// The first-time tour: five short cards. Shown once, right after sign-up, with a Skip button on every
// card; people who already use the app never get it by itself and can replay it from Settings.
// The text is English here and goes through the translation layer when it is drawn.

export interface TourStep {
  key: 'welcome' | 'add' | 'home' | 'people' | 'ready';
  /** An Ionicons name. */
  icon: 'sparkles-outline' | 'add-circle-outline' | 'home-outline' | 'people-outline' | 'checkmark-circle-outline';
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { key: 'welcome', icon: 'sparkles-outline', title: 'Welcome to Prapanji', body: 'A one-minute tour of the five things you will use most. You can skip it and find it again in Settings.' },
  { key: 'add', icon: 'add-circle-outline', title: 'Add a spend in seconds', body: 'Tap the orange + button, type the amount and pick a category. That is all.' },
  { key: 'home', icon: 'home-outline', title: 'See your month at a glance', body: 'Home shows what you spent, what is left after fixed bills and your biggest categories. Reports shows where your money goes.' },
  { key: 'people', icon: 'people-outline', title: 'Split bills with friends', body: 'Open People to split a bill, note who owes you and who you owe, and settle up later.' },
  { key: 'ready', icon: 'checkmark-circle-outline', title: "You're ready", body: 'Add your first spend and watch Home fill in. Find any entry later with Search and Dates in Transactions. You can open this tour again from Settings.' },
];

export const TOUR_LENGTH = TOUR_STEPS.length;

/** Where to go from a card: the first card has no Back, the last has no Next. */
export const stepButtons = (index: number): { back: boolean; next: boolean; skip: boolean } => ({
  back: index > 0 && index < TOUR_LENGTH - 1,
  next: index < TOUR_LENGTH - 1,
  skip: index < TOUR_LENGTH - 1,
});

export const clampStep = (index: number): number => Math.max(0, Math.min(TOUR_LENGTH - 1, Math.trunc(index) || 0));
