import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES, ISSUE_STATUSES, ISSUE_SCREENS, MAX_SCREENSHOT_BYTES } from '../../../constants/issues';

// constants/issues.ts is what the client offers and the routes validate; the
// CHECK constraints in schema.ts are what the database accepts. If one changes
// without the other, a report fails with a 500 instead of a clean 400.
const schema = readFileSync(join(__dirname, '../db/schema.ts'), 'utf8');
const allowed = (constraint: string) => {
  const m = new RegExp(`'${constraint}',\\s*sql\`\\$\\{table\\.\\w+\\} IN \\(([^)]*)\\)`).exec(schema);
  if (!m) throw new Error(`constraint ${constraint} not found in schema.ts`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/'/g, ''))
    .sort();
};

describe('issue constants stay in sync with the database', () => {
  it('categories, severities and statuses match the CHECK constraints', () => {
    expect(ISSUE_CATEGORIES.map((c) => c.key).sort()).toEqual(allowed('issue_reports_category_check'));
    expect(ISSUE_SEVERITIES.map((s) => s.key).sort()).toEqual(allowed('issue_reports_severity_check'));
    expect([...ISSUE_STATUSES].sort()).toEqual(allowed('issue_reports_status_check'));
  });

  it('the screenshot cap matches the database limit', () => {
    expect(schema).toContain(`screenshotSize} <= ${MAX_SCREENSHOT_BYTES}`);
  });

  it('every screen key is unique and every named screen file exists (the digest points developers at it)', () => {
    const keys = ISSUE_SCREENS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const repoRoot = join(__dirname, '../../..');
    for (const s of ISSUE_SCREENS) {
      if (s.file) expect(existsSync(join(repoRoot, s.file))).toBe(true);
    }
  });
});
