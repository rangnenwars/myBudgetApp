// Data analysis over the whole issue_reports stack — run by the nightly
// digest (jobs/issueDigest.ts) *before* it looks at any new issue, so each
// new report is judged in context: is it a duplicate of something already
// reported, is its screen a hotspot, did a new app version start a spike?
// Pure functions over plain records (no DB access) so it is unit-testable
// and the CLI (jobs/run-issue-analysis.ts) can print the same report.

import { ISSUE_SCREENS } from '../../../constants/issues';

export interface IssueRecord {
  id: number;
  category: string;
  severity: string;
  screen: string;
  title: string;
  description: string;
  stepsToReproduce: string | null;
  platform: string | null;
  appVersion: string | null;
  status: string;
  hasScreenshot: boolean;
  createdAt: Date;
  notifiedAt: Date | null;
}

export interface CountEntry {
  key: string;
  count: number;
}

export interface IssueCluster {
  ids: number[];
  size: number;
  label: string;
  screens: string[];
  latestAt: string;
}

export interface PerIssueInsight {
  priorityScore: number;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  similarIssueIds: number[];
  errorSignatures: string[];
  keywords: string[];
  hotspot: boolean;
}

export interface IssueAnalysisReport {
  generatedAt: string;
  totals: {
    all: number;
    open: number;
    pending: number;
    resolved: number;
    last7Days: number;
    previous7Days: number;
    /** % change last 7 days vs the 7 before; null when the earlier week had none. */
    weekOverWeekPct: number | null;
    withScreenshot: number;
  };
  byCategory: CountEntry[];
  bySeverity: CountEntry[];
  byScreen: CountEntry[];
  byPlatform: CountEntry[];
  byAppVersion: CountEntry[];
  hotspots: { screen: string; open: number; highSeverity: number; score: number }[];
  clusters: IssueCluster[];
  topKeywords: CountEntry[];
  errorSignatures: { signature: string; count: number; ids: number[] }[];
  /** App versions first seen in the last 7 days that already have 2+ reports — a likely regression. */
  newVersionSpikes: CountEntry[];
  perIssue: Record<number, PerIssueInsight>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(['new', 'triaged']);
const SEVERITY_WEIGHT: Record<string, number> = { critical: 40, high: 25, medium: 12, low: 5 };
// A budgeting app showing wrong money figures is close to a crash in impact.
const CATEGORY_WEIGHT: Record<string, number> = { crash: 15, data: 12, bug: 6, performance: 4, ui: 2, other: 0 };
const SIMILARITY_THRESHOLD = 0.3;

const STOPWORDS = new Set(
  (
    'the and for with that this from have has had was were are not but you your our its it\'s into when then than ' +
    'there their them they what which who will would should could can cannot cant dont doesnt didnt isnt wont ' +
    'just also very really some any all each every after before again still only even about over under while ' +
    'app page screen button click clicked tap tapped open opened try tried trying get got see seen shows showing ' +
    'issue problem working work works happen happens happened please thanks thank'
  ).split(/\s+/)
);

/** Lowercased, stopword-free, lightly stemmed word tokens. */
export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9₹\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/(ing|ed)$/, '').replace(/([^s])s$/, '$1'))
    // Again after stemming, so "pages" / "clicking" fall to their stopword stems.
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

export const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Error names / HTTP statuses / timeouts quoted in a report, normalized so the same failure groups together. */
export const extractErrorSignatures = (text: string): string[] => {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][A-Za-z]*(?:Error|Exception))\b(?::\s*([^\n.]{0,60}))?/g)) {
    const detail = m[2]?.trim().replace(/\d+/g, 'N').replace(/["'`].*?["'`]/g, '…');
    found.add(detail ? `${m[1]}: ${detail}` : m[1]);
  }
  for (const m of text.matchAll(/\b(?:status(?:\s+code)?|http|error)\s*(?:code\s*)?([45]\d\d)\b/gi)) found.add(`HTTP ${m[1]}`);
  if (/\bnetwork\s+error\b/i.test(text)) found.add('Network Error');
  if (/\btime[ds]?\s?out\b|\btimeout\b/i.test(text)) found.add('Timeout');
  if (/\bundefined is not\b|\bcannot read propert/i.test(text)) found.add('Null/undefined access');
  if (/\bNaN\b/.test(text)) found.add('NaN in output');
  return [...found];
};

const countBy = (items: IssueRecord[], key: (i: IssueRecord) => string | null): CountEntry[] => {
  const map = new Map<string, number>();
  for (const i of items) {
    const k = key(i) ?? 'unknown';
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

const textOf = (i: IssueRecord) => `${i.title}\n${i.description}\n${i.stepsToReproduce ?? ''}`;

const toPriority = (score: number): PerIssueInsight['priority'] => (score >= 60 ? 'P1' : score >= 40 ? 'P2' : score >= 20 ? 'P3' : 'P4');

export const analyzeIssues = (issues: IssueRecord[], now: Date = new Date()): IssueAnalysisReport => {
  const t = now.getTime();
  const last7 = issues.filter((i) => t - i.createdAt.getTime() < 7 * DAY_MS);
  const prev7 = issues.filter((i) => {
    const age = t - i.createdAt.getTime();
    return age >= 7 * DAY_MS && age < 14 * DAY_MS;
  });
  const open = issues.filter((i) => OPEN_STATUSES.has(i.status));

  // --- Similarity + clustering (union-find over pairwise Jaccard) ---
  const tokens = new Map<number, Set<string>>();
  const signatures = new Map<number, string[]>();
  for (const i of issues) {
    tokens.set(i.id, new Set(tokenize(textOf(i))));
    signatures.set(i.id, extractErrorSignatures(textOf(i)));
  }
  const similar = new Map<number, Set<number>>(issues.map((i) => [i.id, new Set<number>()]));
  const parent = new Map<number, number>(issues.map((i) => [i.id, i.id]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (let a = 0; a < issues.length; a++) {
    for (let b = a + 1; b < issues.length; b++) {
      const A = issues[a];
      const B = issues[b];
      let score = jaccard(tokens.get(A.id)!, tokens.get(B.id)!);
      if (A.screen === B.screen && A.screen !== 'other') score += 0.1;
      const sharedSig = signatures.get(A.id)!.some((s) => signatures.get(B.id)!.includes(s) && s !== 'Timeout');
      if (sharedSig) score += 0.25;
      if (score >= SIMILARITY_THRESHOLD) {
        similar.get(A.id)!.add(B.id);
        similar.get(B.id)!.add(A.id);
        parent.set(find(A.id), find(B.id));
      }
    }
  }
  const groups = new Map<number, IssueRecord[]>();
  for (const i of issues) {
    const root = find(i.id);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  const clusters: IssueCluster[] = [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => {
      const termCounts = new Map<string, number>();
      for (const i of g) for (const tok of tokens.get(i.id)!) termCounts.set(tok, (termCounts.get(tok) ?? 0) + 1);
      const label = [...termCounts.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([term]) => term)
        .join(', ');
      return {
        ids: g.map((i) => i.id).sort((a, b) => a - b),
        size: g.length,
        label: label || g[0].title,
        screens: [...new Set(g.map((i) => i.screen))],
        latestAt: new Date(Math.max(...g.map((i) => i.createdAt.getTime()))).toISOString(),
      };
    })
    .sort((a, b) => b.size - a.size || b.latestAt.localeCompare(a.latestAt));

  // --- Keywords & error signatures across the stack ---
  const keywordCounts = new Map<string, number>();
  for (const i of issues) for (const tok of tokens.get(i.id)!) keywordCounts.set(tok, (keywordCounts.get(tok) ?? 0) + 1);
  const topKeywords = [...keywordCounts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 15);

  const sigIndex = new Map<string, number[]>();
  for (const i of issues) for (const s of signatures.get(i.id)!) sigIndex.set(s, [...(sigIndex.get(s) ?? []), i.id]);
  const errorSignatures = [...sigIndex.entries()]
    .map(([signature, ids]) => ({ signature, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));

  // --- Hotspots: screens with the most open, severe reports ---
  const hotspots = ISSUE_SCREENS.map((s) => {
    const onScreen = open.filter((i) => i.screen === s.key);
    const highSeverity = onScreen.filter((i) => i.severity === 'high' || i.severity === 'critical').length;
    return { screen: s.key, open: onScreen.length, highSeverity, score: onScreen.length + highSeverity * 2 };
  })
    .filter((h) => h.open > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const hotspotScreens = new Set<string>(hotspots.filter((h) => h.score >= 4).map((h) => h.screen));

  // --- Version regressions: versions whose first report is recent and that already have several ---
  const firstSeen = new Map<string, number>();
  for (const i of issues) {
    if (!i.appVersion) continue;
    firstSeen.set(i.appVersion, Math.min(firstSeen.get(i.appVersion) ?? Infinity, i.createdAt.getTime()));
  }
  const newVersionSpikes = countBy(
    issues.filter((i) => i.appVersion && t - firstSeen.get(i.appVersion)! < 7 * DAY_MS),
    (i) => i.appVersion
  ).filter((v) => v.count >= 2);

  // --- Per-issue priority ---
  const perIssue: Record<number, PerIssueInsight> = {};
  for (const i of issues) {
    const sims = [...similar.get(i.id)!].sort((a, b) => a - b);
    const sigs = signatures.get(i.id)!;
    const hotspot = hotspotScreens.has(i.screen);
    let score = (SEVERITY_WEIGHT[i.severity] ?? 0) + (CATEGORY_WEIGHT[i.category] ?? 0);
    score += Math.min(sims.length * 5, 25); // many people hitting the same thing
    if (hotspot) score += 8;
    if (sigs.length > 0) score += 3; // concrete error text = actionable
    if (i.appVersion && newVersionSpikes.some((v) => v.key === i.appVersion)) score += 5;
    perIssue[i.id] = {
      priorityScore: score,
      priority: toPriority(score),
      similarIssueIds: sims,
      errorSignatures: sigs,
      keywords: [...tokens.get(i.id)!].slice(0, 8),
      hotspot,
    };
  }

  return {
    generatedAt: now.toISOString(),
    totals: {
      all: issues.length,
      open: open.length,
      pending: issues.filter((i) => i.notifiedAt === null).length,
      resolved: issues.filter((i) => i.status === 'resolved').length,
      last7Days: last7.length,
      previous7Days: prev7.length,
      weekOverWeekPct: prev7.length === 0 ? null : Math.round(((last7.length - prev7.length) / prev7.length) * 100),
      withScreenshot: issues.filter((i) => i.hasScreenshot).length,
    },
    byCategory: countBy(issues, (i) => i.category),
    bySeverity: countBy(issues, (i) => i.severity),
    byScreen: countBy(issues, (i) => i.screen),
    byPlatform: countBy(issues, (i) => i.platform),
    byAppVersion: countBy(issues, (i) => i.appVersion),
    hotspots,
    clusters,
    topKeywords,
    errorSignatures,
    newVersionSpikes,
    perIssue,
  };
};

// ---------- Rule-based fix suggestions (used when no Claude API key is set, or the call fails) ----------

// Server-side code behind each screen — where data/perf bugs usually live.
const SERVER_FILES: Record<string, string[]> = {
  dashboard: ['server/src/routes/reports.ts', 'utils/calculations.ts'],
  transactions: ['server/src/routes/transactions.ts', 'server/src/lib/recurringTransactions.ts'],
  input_expenses: ['server/src/routes/transactions.ts', 'utils/calculations.ts'],
  loans: ['server/src/routes/loans.ts', 'server/src/lib/loanEmiExpenses.ts', 'utils/calculations.ts'],
  investments: ['server/src/routes/investments.ts'],
  goals: ['server/src/routes/goals.ts'],
  reports: ['server/src/routes/reports.ts', 'utils/calculations.ts'],
  login: ['server/src/routes/auth.ts', 'context/AuthContext.tsx', 'utils/tokenStorage.ts'],
  admin: ['server/src/routes/admin.ts'],
};

const KEYWORD_HINTS: { pattern: RegExp; hint: string; files: string[] }[] = [
  { pattern: /log ?in|sign ?in|log ?out|session|token|password/i, hint: 'Check the token refresh/expiry flow — a 401 that the axios interceptor fails to recover from will look like a random sign-out.', files: ['utils/api.ts', 'context/AuthContext.tsx'] },
  { pattern: /csv|export|download/i, hint: 'Reproduce the export for the same month range and diff the CSV against the on-screen totals.', files: ['server/src/routes/reports.ts', 'utils/exportFile.ts'] },
  { pattern: /date|month|year|calendar/i, hint: 'Look for timezone / month-boundary handling — dates built with toISOString() shift a day for users ahead of UTC.', files: ['utils/dates.ts'] },
  { pattern: /emi|loan|interest|payoff/i, hint: 'Re-run the EMI / payoff calculation for this loan in a unit test with the reported numbers.', files: ['server/src/lib/loanEmiExpenses.ts', 'utils/calculations.ts'] },
  { pattern: /recurring|repeat|every month/i, hint: 'Check recurring-rule materialization for duplicate or skipped months.', files: ['server/src/lib/recurringTransactions.ts'] },
  { pattern: /categor/i, hint: 'Verify the category key exists for this user (custom vs system categories) and that CategoriesContext has loaded before render.', files: ['server/src/routes/categories.ts', 'context/CategoriesContext.tsx'] },
  { pattern: /chart|graph|pie/i, hint: 'react-native-chart-kit breaks on empty or NaN datasets — guard the data before rendering.', files: ['app/(tabs)/reports.tsx'] },
];

const CATEGORY_HINTS: Record<string, string> = {
  crash: 'Reproduce with the dev build and capture the red-box / console stack; wrap the screen in an error boundary so one bad render does not take down the app.',
  data: 'Compare the API response for the same month with what the screen shows to split server-side calculation bugs from client formatting bugs; add a regression test with the reported figures.',
  bug: 'Reproduce with the steps given, then add a test that fails before the fix.',
  performance: 'Profile the API calls this screen makes (count + latency); look for per-row requests that should be one query, missing indexes, or unmemoized lists.',
  ui: 'Check the layout at phone width and on web (react-native-web differs on flex/overflow); verify long text and large numbers wrap.',
  other: 'Ask the reporter for steps to reproduce if they are unclear.',
};

export const heuristicSuggestion = (issue: IssueRecord, insight: PerIssueInsight | undefined): string => {
  const screen = ISSUE_SCREENS.find((s) => s.key === issue.screen);
  const files = new Set<string>([...(screen?.file ? [screen.file] : []), ...(SERVER_FILES[issue.screen] ?? [])]);
  const lines: string[] = [CATEGORY_HINTS[issue.category] ?? CATEGORY_HINTS.other];
  const text = textOf(issue);
  for (const k of KEYWORD_HINTS) {
    if (k.pattern.test(text)) {
      lines.push(k.hint);
      k.files.forEach((f) => files.add(f));
    }
  }
  if (insight?.errorSignatures.length) lines.push(`Search server logs for: ${insight.errorSignatures.join(', ')}.`);
  if (insight?.similarIssueIds.length) lines.push(`Likely the same root cause as #${insight.similarIssueIds.join(', #')} — fix once and close them together.`);
  if (issue.platform === 'web') lines.push('Reported on web — check whether a native-only API (SecureStore, FileSystem, Alert) is being hit.');
  if (files.size) lines.push(`Start in: ${[...files].join(', ')}`);
  return lines.join('\n');
};
