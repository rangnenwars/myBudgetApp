// Manual/cron entrypoint for the weekly "improve the common category list"
// batch — see lib/categoryPromotion.ts for what it actually does and why
// it's safe to re-run. The in-process scheduler in index.ts calls
// promoteCommonCategories() directly on the same weekly cadence; this
// script exists so it can also be triggered by hand or from an external
// cron (`docker exec <server-container> npm run batch:promote-categories`).

import 'dotenv/config';
import { pool } from './client';
import { promoteCommonCategories } from '../lib/categoryPromotion';

async function main() {
  console.log('Scanning custom categories for community-wide adoption...');
  const promoted = await promoteCommonCategories();

  if (promoted.length === 0) {
    console.log('Nothing met the threshold this run.');
  } else {
    for (const p of promoted) {
      console.log(`Promoted "${p.label}" (${p.type}, key: ${p.key}) — adopted independently by ${p.adopters} users.`);
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error('Category promotion batch failed:', err);
  process.exit(1);
});
