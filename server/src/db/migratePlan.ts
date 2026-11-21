import 'dotenv/config';
import { Pool } from 'pg';
import { PLAN, planStatus, problems, rollbackTo } from './migrationPlan';

// npm run db:plan -- status            which migrations are applied, and whether each result is really there
// npm run db:plan -- verify            same, but exits 1 if anything is wrong (used after a deploy)
// npm run db:plan -- rollback <tag> --yes   undo that migration and every newer one, in one transaction
// Applying is the migrator's job (npm run db:migrate, run at container start).

const usage = () => {
  console.error('Usage: db:plan status | verify | rollback <migration tag> --yes');
  process.exit(2);
};

async function main() {
  const [cmd, arg, flag] = process.argv.slice(2);
  if (!['status', 'verify', 'rollback'].includes(cmd ?? '')) usage();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    if (cmd === 'rollback') {
      const step = PLAN.find((s) => s.tag === arg);
      if (!arg || !step) {
        console.error(`Give one of: ${PLAN.map((s) => s.tag).join(', ')}`);
        process.exit(2);
      }
      if (flag !== '--yes') {
        console.error(`Undoing ${arg} (and anything newer) loses ${step.rollbackLoses}. Take a backup, then run again with --yes.`);
        process.exit(2);
      }
      console.log('Undone:', (await rollbackTo(pool, arg)).join(', '));
      return;
    }
    const status = await planStatus(pool);
    // Old, long-settled migrations are hidden; anything pending, in the plan, or wrong is always shown.
    for (const s of status.filter((x) => !x.applied || x.verified !== null || arg === '--all')) {
      const state = s.applied ? (s.verified === false ? 'APPLIED BUT RESULT MISSING' : 'applied') : 'pending';
      console.log(`${s.applied ? '[x]' : '[ ]'} ${s.tag.padEnd(34)} ${state}${s.verified === true ? ', verified' : ''}`);
    }
    const bad = problems(status);
    bad.forEach((b) => console.error(`PROBLEM: ${b}`));
    if (cmd === 'verify' && (bad.length || status.some((s) => !s.applied))) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
