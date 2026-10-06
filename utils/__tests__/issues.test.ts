import { base64ByteLength } from '../issues';
import { MAX_SCREENSHOT_BYTES } from '../../constants/issues';

jest.mock('../api', () => ({ api: { post: jest.fn(), get: jest.fn() } }));

// The constants-vs-database consistency check lives in the server suite
// (server/src/__tests__/issueConstants.test.ts), which can read schema.ts.

/** Base64 of `size` zero bytes, built without Node's Buffer (not in the client's types). */
const zeros = (size: number) => btoa('\0'.repeat(size));

describe('base64ByteLength', () => {
  it('matches the real decoded size for every padding case', () => {
    for (const size of [0, 1, 2, 3, 4, 5, 1000, 1001, 1002]) {
      expect(base64ByteLength(zeros(size))).toBe(size);
    }
  });

  it('ignores a data: URL prefix and whitespace', () => {
    const b64 = btoa('hello world');
    expect(base64ByteLength(`data:image/png;base64,${b64}`)).toBe(11);
    expect(base64ByteLength(b64.replace(/(.{4})/g, '$1\n'))).toBe(11);
  });

  it('puts exactly 2 MB at the limit and one byte more over it', () => {
    expect(base64ByteLength(zeros(MAX_SCREENSHOT_BYTES))).toBe(MAX_SCREENSHOT_BYTES);
    expect(base64ByteLength(zeros(MAX_SCREENSHOT_BYTES + 1))).toBeGreaterThan(MAX_SCREENSHOT_BYTES);
  });
});

describe('issue API calls', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { api } = require('../api') as { api: { post: jest.Mock; get: jest.Mock } };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { submitIssueReport, getMyIssueReports } = require('../issues') as typeof import('../issues');

  it('posts a report with a long upload timeout and returns the saved row', async () => {
    api.post.mockResolvedValue({ data: { id: 9, status: 'new' } });
    const report = { category: 'bug', severity: 'low', screen: 'goals', title: 'Bar overflows', description: 'Past the card edge.' } as const;
    await expect(submitIssueReport(report)).resolves.toEqual({ id: 9, status: 'new' });
    expect(api.post).toHaveBeenCalledWith('/issues', report, { timeout: 60_000 });
  });

  it("fetches the user's own reports", async () => {
    api.get.mockResolvedValue({ data: [{ id: 1 }] });
    await expect(getMyIssueReports()).resolves.toEqual([{ id: 1 }]);
    expect(api.get).toHaveBeenCalledWith('/issues/mine');
  });
});
