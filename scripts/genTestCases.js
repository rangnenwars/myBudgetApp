#!/usr/bin/env node
// Writes docs/TEST_CASES.md from real Jest results, so the list is never typed by hand.
//
//   npx jest --coverage=false --json --outputFile=app.json
//   (cd server && npx jest --coverage=false --json --outputFile=../server.json)
//   node scripts/genTestCases.js server.json app.json
//
// Each argument is a Jest --json result file: the first is the server suite, the second the app suite.
// Every test name is listed under its file and its describe group, with its result.

const fs = require('fs');
const path = require('path');

const [serverFile, appFile] = process.argv.slice(2);
if (!serverFile || !appFile) {
  console.error('Usage: node scripts/genTestCases.js <server-results.json> <app-results.json>');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const mark = (status) => (status === 'passed' ? 'PASS' : status === 'failed' ? 'FAIL' : 'SKIP');

const describeSuite = (result, base) => {
  const files = result.testResults
    .map((suite) => {
      const rel = path.relative(base, suite.name).split(path.sep).join('/');
      const groups = new Map();
      for (const t of suite.assertionResults) {
        const key = t.ancestorTitles.join(' › ');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      }
      return { rel, count: suite.assertionResults.length, groups };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    files,
    total: result.numTotalTests,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
  };
};

const render = (suite) => {
  const out = [];
  for (const f of suite.files) {
    out.push(`### \`${f.rel}\` (${f.count})`, '');
    for (const [group, tests] of f.groups) {
      if (group) out.push(`**${group}**`, '');
      for (const t of tests) out.push(`- [${mark(t.status)}] ${t.title}`);
      out.push('');
    }
  }
  return out.join('\n');
};

const server = describeSuite(load(serverFile), path.join(root, 'server'));
const app = describeSuite(load(appFile), root);
const today = new Date().toISOString().slice(0, 10);

const md = [
  '# Test cases for review',
  '',
  `Generated ${today} from the Jest suites by \`scripts/genTestCases.js\` (every test name, grouped by file and section, with its latest result). Regenerate it after adding tests; do not edit it by hand.`,
  '',
  '| Suite | Test files | Test cases | Passed | Failed |',
  '|---|---|---|---|---|',
  `| Server | ${server.files.length} | ${server.total} | ${server.passed} | ${server.failed} |`,
  `| Client | ${app.files.length} | ${app.total} | ${app.passed} | ${app.failed} |`,
  '',
  '',
  '---',
  '',
  '## Server tests',
  '',
  render(server),
  '',
  '---',
  '',
  '## Client tests',
  '',
  render(app),
  '',
].join('\n');

fs.writeFileSync(path.join(root, 'docs', 'TEST_CASES.md'), md);
console.log(`docs/TEST_CASES.md: server ${server.passed}/${server.total} in ${server.files.length} files, client ${app.passed}/${app.total} in ${app.files.length} files`);
