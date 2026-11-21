// One-off tool: rewrites text built from values, such as `Next: ${date}`, into t('Next: {0}', { 0: date }),
// so it can be translated as a whole sentence. Skips web addresses, file names and code.
// Usage: node scripts/i18nWrapTemplates.js [--dry]
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'components', 'context', 'utils'];
const SKIP_FILE = /(__tests__|\.test\.|i18n|api\.ts|tokenStorage|database\.ts|exportFile|plan\.ts$|calendar\.ts)/;
const dry = process.argv.includes('--dry');

const keep = (text) => {
  const plain = text.replace(/\{\d+\}/g, '');
  if (!/[A-Za-z]{2,}/.test(plain)) return false;
  if (/(MB|KB|Cr)/.test(plain)) return false; // units, written the same in Hindi
  if (/^\//.test(text) || /mybudget-/.test(text) || /charset=/.test(text) || /^withFeature\(/.test(text)) return false;
  return true;
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__tests__') yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(e.name) && !SKIP_FILE.test(full.replace(ROOT, ''))) yield full;
  }
}

const importPath = (file) => {
  let rel = path.relative(path.dirname(file), path.join(ROOT, 'utils', 'i18n')).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
};

let total = 0;
const keys = new Set();
for (const d of DIRS) {
  for (const file of walk(path.join(ROOT, d))) {
    const text = fs.readFileSync(file, 'utf8');
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edits = []; // { start, end, replacement }
    const visit = (node, insideEdit) => {
      if (ts.isTemplateExpression(node) && !insideEdit) {
        const cooked = node.head.text + node.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join('');
        // A template used as a tagged template, in an import, or as a CSS-like value is not for people.
        if (!ts.isTaggedTemplateExpression(node.parent) && keep(cooked)) {
          const vars = node.templateSpans.map((s, i) => `${i}: ${s.expression.getText()}`).join(', ');
          const lit = "'" + cooked.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'";
          edits.push({ start: node.getStart(), end: node.getEnd(), replacement: `t(${lit}, { ${vars} })` });
          keys.add(cooked);
          return; // do not rewrite templates nested inside this one
        }
      }
      ts.forEachChild(node, (c) => visit(c, insideEdit));
    };
    visit(src, false);
    if (!edits.length) continue;
    total += edits.length;
    if (dry) { console.log(path.relative(ROOT, file), edits.length); continue; }
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'[^']*\/i18n'/.test(out)) {
      const nl = out.includes('\r\n') ? '\r\n' : '\n';
      // After the last import line.
      const imports = [...out.matchAll(/^import[\s\S]*?;\s*$/gm)];
      const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
      out = out.slice(0, at) + `${nl}import { t } from '${importPath(file)}';` + out.slice(at);
    }
    fs.writeFileSync(file, out);
  }
}
console.log(total, 'templates', dry ? '(dry run)' : 'rewritten');
if (process.argv.includes('--keys')) console.log(JSON.stringify([...keys].sort(), null, 1));
