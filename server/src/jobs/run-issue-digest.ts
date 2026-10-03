// Runs the nightly issue digest once, now:
//   npm run issues:digest              # analyse, suggest, email, mark notified
//   npm run issues:digest -- --dry-run # analyse and print the email; no Claude calls, sends or writes
// In Docker: docker compose exec server npm run issues:digest -- --dry-run

import 'dotenv/config';
import { pool } from '../db/client';
import { runIssueDigestExclusive } from './issueDigest';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = await runIssueDigestExclusive({ dryRun });
  if (result) {
    console.log(
      `[issue-digest] done: ${result.analyzed} analysed, ${result.newIssues} new, ` +
        (result.emailed ? `emailed ${result.recipients.join(', ')}` : `not emailed (${result.skippedReason})`)
    );
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
