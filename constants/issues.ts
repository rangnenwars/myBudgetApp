// Shared by the client's Report issue screen and the server's validation /
// nightly digest, so the allowed values can't drift between the two.

export const ISSUE_CATEGORIES = [
  { key: 'bug', label: 'Something is broken' },
  { key: 'crash', label: 'App crashed / froze' },
  { key: 'data', label: 'Wrong numbers or data' },
  { key: 'ui', label: 'Layout / display' },
  { key: 'performance', label: 'Slow' },
  { key: 'other', label: 'Other' },
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]['key'];

export const ISSUE_SEVERITIES = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'critical', label: 'Blocking' },
] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]['key'];

export const ISSUE_STATUSES = ['new', 'triaged', 'resolved', 'wont_fix'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

// `file` is where the nightly digest tells the developer to start looking —
// keep it in sync if a screen moves.
export const ISSUE_SCREENS = [
  { key: 'dashboard', label: 'Dashboard', file: 'app/(tabs)/index.tsx' },
  { key: 'transactions', label: 'Transactions', file: 'app/(tabs)/transactions.tsx' },
  { key: 'input_expenses', label: 'Input expenses', file: 'app/input-expenses.tsx' },
  { key: 'loans', label: 'Loans', file: 'app/(tabs)/loans.tsx' },
  { key: 'investments', label: 'Investments', file: 'app/(tabs)/investments.tsx' },
  { key: 'goals', label: 'Goals', file: 'app/(tabs)/goals.tsx' },
  { key: 'reports', label: 'Reports', file: 'app/(tabs)/reports.tsx' },
  { key: 'login', label: 'Sign in / register', file: 'app/login.tsx' },
  { key: 'admin', label: 'Admin', file: 'app/admin/index.tsx' },
  { key: 'other', label: 'Somewhere else', file: '' },
] as const;
export type IssueScreen = (typeof ISSUE_SCREENS)[number]['key'];

/** Screenshot attachment cap — enforced on the client before upload and again on the server after decoding. */
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const SCREENSHOT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ScreenshotMimeType = (typeof SCREENSHOT_MIME_TYPES)[number];
