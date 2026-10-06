// Bug-fix suggestions for the nightly issue digest — worked out on the server
// by heuristicSuggestion (issueAnalysis.ts) from the screen, the report's
// wording and the stack analysis. Nothing is sent to any outside service:
// users' report text never leaves the server except in the digest email.

import { IssueRecord, PerIssueInsight, heuristicSuggestion } from './issueAnalysis';

export interface IssueForSuggestion extends IssueRecord {
  expectedBehavior: string | null;
  deviceInfo: string | null;
  screenshot: Buffer | null;
  screenshotMimeType: string | null;
}

export interface FixSuggestion {
  suggestedFix: string;
}

export const suggestFix = (issue: IssueRecord, insight: PerIssueInsight | undefined): FixSuggestion => ({
  suggestedFix: heuristicSuggestion(issue, insight),
});
