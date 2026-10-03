// Client calls for the Report issue screen (server/src/routes/issues.ts).
// Kept out of utils/database.ts so the feature is self-contained.

import { api } from './api';
import { IssueCategory, IssueScreen, IssueSeverity, IssueStatus, ScreenshotMimeType } from '../constants/issues';

export interface NewIssueReport {
  category: IssueCategory;
  severity: IssueSeverity;
  screen: IssueScreen;
  title: string;
  description: string;
  steps_to_reproduce?: string | null;
  expected_behavior?: string | null;
  platform?: string | null;
  app_version?: string | null;
  device_info?: string | null;
  /** Base64 (raw or data: URL), already checked against MAX_SCREENSHOT_BYTES. */
  screenshot?: { data: string; mime_type: ScreenshotMimeType } | null;
}

export interface IssueReportSummary {
  id: number;
  category: IssueCategory;
  severity: IssueSeverity;
  screen: IssueScreen;
  title: string;
  description: string;
  has_screenshot: boolean;
  screenshot_size: number | null;
  status: IssueStatus;
  created_at: string;
}

export const submitIssueReport = async (report: NewIssueReport): Promise<IssueReportSummary> => {
  // Large bodies upload slowly on mobile data — allow longer than the default.
  const { data } = await api.post('/issues', report, { timeout: 60_000 });
  return data;
};

export const getMyIssueReports = async (): Promise<IssueReportSummary[]> => {
  const { data } = await api.get('/issues/mine');
  return data;
};

/** Decoded byte length of a base64 string (raw or data: URL) without decoding it. */
export const base64ByteLength = (b64: string): number => {
  const body = b64.replace(/^data:[^;,]+;base64,/, '').replace(/\s/g, '');
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - padding;
};
