import { analyzeIssues, extractErrorSignatures, heuristicSuggestion, IssueRecord, jaccard, tokenize } from '../lib/issueAnalysis';
import { msUntilNext, parseDigestTime } from '../jobs/scheduler';

const NOW = new Date('2026-10-03T02:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

let nextId = 1;
const issue = (over: Partial<IssueRecord> = {}): IssueRecord => ({
  id: nextId++,
  category: 'bug',
  severity: 'medium',
  screen: 'transactions',
  title: 'Something odd',
  description: 'Generic description of a thing',
  stepsToReproduce: null,
  platform: 'android',
  appVersion: '1.0.0',
  status: 'new',
  hasScreenshot: false,
  createdAt: daysAgo(1),
  notifiedAt: null,
  ...over,
});

describe('tokenize / jaccard', () => {
  it('drops stopwords, short words and numbers, and stems plurals', () => {
    expect(tokenize('The totals are wrong on 12 reports pages')).toEqual(['total', 'wrong', 'report']);
  });
  it('keeps words ending in ss intact', () => {
    expect(tokenize('class loss')).toEqual(['class', 'loss']);
  });
  it('scores identical sets 1 and disjoint sets 0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(), new Set(['b']))).toBe(0);
  });
});

describe('extractErrorSignatures', () => {
  it('finds error names, HTTP statuses, timeouts and NaN', () => {
    const sigs = extractErrorSignatures('Got TypeError: Cannot read property x of undefined, then status 500 and it timed out. Shows NaN.');
    expect(sigs).toEqual(expect.arrayContaining(['HTTP 500', 'Timeout', 'NaN in output', 'Null/undefined access']));
    expect(sigs.some((s) => s.startsWith('TypeError'))).toBe(true);
  });
  it('returns nothing for plain prose', () => {
    expect(extractErrorSignatures('The button colour is a bit dull')).toEqual([]);
  });
});

describe('analyzeIssues', () => {
  it('clusters near-duplicate reports and raises their priority', () => {
    const a = issue({ title: 'Loan EMI total wrong', description: 'The EMI total for my home loan shows the wrong amount', screen: 'loans', category: 'data' });
    const b = issue({ title: 'EMI amount wrong on loans', description: 'Home loan EMI amount is wrong after part payment', screen: 'loans', category: 'data' });
    const c = issue({ title: 'Dark text on dark card', description: 'Goal names are hard to read', screen: 'goals', category: 'ui', severity: 'low' });
    const report = analyzeIssues([a, b, c], NOW);

    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0].ids).toEqual([a.id, b.id]);
    expect(report.perIssue[a.id].similarIssueIds).toEqual([b.id]);
    expect(report.perIssue[c.id].similarIssueIds).toEqual([]);
    expect(report.perIssue[a.id].priorityScore).toBeGreaterThan(report.perIssue[c.id].priorityScore);
    expect(report.perIssue[c.id].priority).toBe('P4');
  });

  it('groups reports that quote the same error even with different wording', () => {
    const a = issue({ title: 'Cannot save', description: 'Saving fails with TypeError: x is not a function' });
    const b = issue({ title: 'Export broken', description: 'Got TypeError: x is not a function', screen: 'reports' });
    const report = analyzeIssues([a, b], NOW);
    expect(report.errorSignatures[0]).toMatchObject({ count: 2, ids: [a.id, b.id] });
    expect(report.perIssue[a.id].similarIssueIds).toEqual([b.id]);
  });

  it('computes totals, week-over-week trend, breakdowns and hotspots', () => {
    const issues = [
      issue({ severity: 'critical', category: 'crash', createdAt: daysAgo(1) }),
      issue({ severity: 'high', createdAt: daysAgo(2) }),
      issue({ createdAt: daysAgo(3), status: 'resolved', notifiedAt: daysAgo(2), hasScreenshot: true }),
      issue({ screen: 'goals', createdAt: daysAgo(9), notifiedAt: daysAgo(8) }),
    ];
    const r = analyzeIssues(issues, NOW);
    expect(r.totals).toMatchObject({ all: 4, open: 3, pending: 2, resolved: 1, last7Days: 3, previous7Days: 1, weekOverWeekPct: 200, withScreenshot: 1 });
    expect(r.byScreen[0]).toEqual({ key: 'transactions', count: 3 });
    expect(r.hotspots[0]).toMatchObject({ screen: 'transactions', open: 2, highSeverity: 2 });
    expect(r.perIssue[issues[0].id]).toMatchObject({ hotspot: true, priority: 'P1' });
  });

  it('flags a new app version that already has several reports', () => {
    const r = analyzeIssues(
      [
        issue({ appVersion: '1.0.0', createdAt: daysAgo(30) }),
        issue({ appVersion: '1.1.0', createdAt: daysAgo(2) }),
        issue({ appVersion: '1.1.0', createdAt: daysAgo(1) }),
      ],
      NOW
    );
    expect(r.newVersionSpikes).toEqual([{ key: '1.1.0', count: 2 }]);
  });

  it('handles an empty stack', () => {
    const r = analyzeIssues([], NOW);
    expect(r.totals.all).toBe(0);
    expect(r.totals.weekOverWeekPct).toBeNull();
    expect(r.clusters).toEqual([]);
  });
});

describe('heuristicSuggestion', () => {
  it('points at the screen and server files plus keyword-specific hints', () => {
    const i = issue({ screen: 'loans', category: 'data', description: 'EMI for my loan is wrong this month', platform: 'web' });
    const text = heuristicSuggestion(i, analyzeIssues([i], NOW).perIssue[i.id]);
    expect(text).toMatch(/app\/\(tabs\)\/loans\.tsx/);
    expect(text).toMatch(/loanEmiExpenses\.ts/);
    expect(text).toMatch(/timezone/);
    expect(text).toMatch(/Reported on web/);
  });
});

describe('scheduler timing', () => {
  it('waits until later today, or rolls over to tomorrow', () => {
    expect(msUntilNext(new Date(2026, 9, 3, 1, 30, 0), 2, 0)).toBe(30 * 60 * 1000);
    expect(msUntilNext(new Date(2026, 9, 3, 2, 0, 0), 2, 0)).toBe(24 * 60 * 60 * 1000);
  });
  it('parses HH:MM and falls back to 02:00', () => {
    expect(parseDigestTime('23:45')).toEqual({ hour: 23, minute: 45 });
    expect(parseDigestTime('25:00')).toEqual({ hour: 2, minute: 0 });
    expect(parseDigestTime(undefined)).toEqual({ hour: 2, minute: 0 });
  });
});
