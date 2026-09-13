import 'dotenv/config';
import cron from 'node-cron';
import { createApp } from './app';
import { promoteCommonCategories } from './lib/categoryPromotion';

for (const name of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const app = createApp();
const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`My Budget API listening on :${port}`);
});

// Weekly, Sunday 03:00 server time — see lib/categoryPromotion.ts for what
// this does and why it can't touch anyone's financial data. noOverlap
// guards against a slow run still going when the next Sunday comes around;
// can also be triggered by hand via `npm run batch:promote-categories`.
cron.schedule(
  '0 3 * * 0',
  async () => {
    try {
      const promoted = await promoteCommonCategories();
      if (promoted.length > 0) {
        console.log(`[category-promotion] promoted ${promoted.length} categor${promoted.length === 1 ? 'y' : 'ies'} to the common list.`);
      }
    } catch (err) {
      console.error('[category-promotion] weekly batch failed:', err);
    }
  },
  { name: 'promote-common-categories', noOverlap: true }
);
