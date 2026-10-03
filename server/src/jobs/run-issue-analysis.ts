// Prints the data analysis of the whole issue-report stack (the same report
// the nightly digest builds before it looks at new issues):
//   npm run issues:analyze            # human-readable summary
//   npm run issues:analyze -- --json  # full report, including per-issue priority

import 'dotenv/config';
import { pool } from '../db/client';
import { analyzeIssues } from '../lib/issueAnalysis';
import { loadIssueStack } from './issueDigest';

async function main() {
  const now = new Date();
  const report = analyzeIssues(await loadIssueStack(now), now);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const t = report.totals;
    const list = (e: { key: string; count: number }[]) => e.map((x) => `${x.key}=${x.count}`).join('  ') || '—';
    console.log(`Issue stack — ${report.generatedAt}`);
    console.log(`  total ${t.all} · open ${t.open} · resolved ${t.resolved} · awaiting email ${t.pending} · with screenshot ${t.withScreenshot}`);
    console.log(`  last 7 days ${t.last7Days} vs previous 7 ${t.previous7Days} (${t.weekOverWeekPct ?? 'n/a'}%)`);
    console.log(`  category:  ${list(report.byCategory)}`);
    console.log(`  severity:  ${list(report.bySeverity)}`);
    console.log(`  screen:    ${list(report.byScreen)}`);
    console.log(`  platform:  ${list(report.byPlatform)}`);
    console.log(`  version:   ${list(report.byAppVersion)}`);
    console.log(`  hotspots:  ${report.hotspots.map((h) => `${h.screen}(open ${h.open}, high+ ${h.highSeverity})`).join('  ') || '—'}`);
    console.log(`  keywords:  ${list(report.topKeywords)}`);
    console.log(`  errors:    ${report.errorSignatures.map((e) => `${e.signature}×${e.count}`).join('  ') || '—'}`);
    console.log(`  spikes:    ${list(report.newVersionSpikes)}`);
    console.log(`  clusters:`);
    for (const c of report.clusters) console.log(`    [${c.label}] ${c.size} reports: #${c.ids.join(', #')}`);
    const ranked = Object.entries(report.perIssue).sort((a, b) => b[1].priorityScore - a[1].priorityScore).slice(0, 10);
    console.log(`  top priority:`);
    for (const [id, p] of ranked) console.log(`    #${id} ${p.priority} (score ${p.priorityScore})${p.similarIssueIds.length ? ` ~ #${p.similarIssueIds.join(', #')}` : ''}`);
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
