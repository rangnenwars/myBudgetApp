import { readFileSync } from 'fs';
import { join } from 'path';
import { suggestFix } from '../lib/issueSuggestions';
import { analyzeIssues, IssueRecord } from '../lib/issueAnalysis';

const issue: IssueRecord = {
  id: 1,
  category: 'data',
  severity: 'high',
  screen: 'loans',
  title: 'EMI total wrong',
  description: 'The EMI total shows ₹500 more than my bank says.',
  stepsToReproduce: null,
  platform: 'android',
  appVersion: '1.0.0',
  status: 'new',
  hasScreenshot: false,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  notifiedAt: null,
};

describe('suggestFix', () => {
  it("is worked out on the server from the report and the stack analysis", () => {
    const fix = suggestFix(issue, analyzeIssues([issue], new Date('2026-10-02T00:00:00Z')).perIssue[1]);
    expect(fix.suggestedFix).toMatch(/app\/\(tabs\)\/loans\.tsx/);
    expect(fix.suggestedFix).toMatch(/loanEmiExpenses\.ts/);
  });

  it('still suggests something without analysis context', () => {
    expect(suggestFix(issue, undefined).suggestedFix.length).toBeGreaterThan(0);
  });
});

describe('issue reports never leave the server', () => {
  // The privacy policy and the Report issue screen promise this. If an AI or
  // other outside-processing SDK is added, those texts must change first.
  it('the server depends on no AI / outside-processing SDK', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /anthropic|openai|gemini|mistral|cohere|langchain/i.test(d))).toEqual([]);
  });
});
