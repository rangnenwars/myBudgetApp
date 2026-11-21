// Finds the messages the server sends to people (errors and validation text), so each has Hindi.
// Used by `npm run i18n:missing` and utils/__tests__/i18nCoverage.test.ts.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'src');
const CALLS = new Set(['badRequest', 'unauthorized', 'forbidden', 'notFound', 'conflict', 'AppError', 'tooManyRequests']);
// Where a string literal is the second argument of a zod check, or an `error:` / `message:` property.
const ZOD = new Set(['min', 'max', 'int', 'positive', 'nonnegative', 'regex', 'refine', 'length', 'email', 'trim']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') yield* walk(full);
    } else if (e.name.endsWith('.ts')) yield full;
  }
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const isText = (s) => /[A-Za-z]{3,}/.test(s) && /\s/.test(s.trim()) || /^[A-Z][a-z]+[a-z .']*\.?$/.test(s.trim());

function extractAll() {
  const out = {}; // text -> first place
  const dynamic = [];
  for (const file of walk(SERVER)) {
    const text = fs.readFileSync(file, 'utf8');
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const add = (s, node) => {
      const c = collapse(s);
      if (c && isText(c)) out[c] ||= rel + ':' + (src.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    };
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        const strArgs = node.arguments.filter((a) => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a));
        if (CALLS.has(name)) strArgs.forEach((a) => add(a.text, a));
        else if (ZOD.has(name)) strArgs.forEach((a) => add(a.text, a));
        for (const a of node.arguments) {
          if (CALLS.has(name) && ts.isTemplateExpression(a)) {
            dynamic.push({ text: collapse(a.head.text + a.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join('')), file: rel });
          }
          // { message: '...' } / { error: '...' } passed to refine and friends
          if (ts.isObjectLiteralExpression(a)) {
            for (const p of a.properties) {
              if (ts.isPropertyAssignment(p) && /^(message|error)$/.test(p.name.getText()) && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) add(p.initializer.text, p.initializer);
            }
          }
        }
      }
      if (ts.isPropertyAssignment(node) && /^(error|message)$/.test(node.name.getText()) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) add(node.initializer.text, node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return { strings: out, dynamic };
}

module.exports = { extractAll };

if (require.main === module) {
  const { strings, dynamic } = extractAll();
  const keys = Object.keys(strings).sort();
  console.log(keys.length, 'server messages,', dynamic.length, 'with values');
  if (process.argv.includes('--list')) keys.forEach((k, i) => console.log(i + 1 + '\t' + k));
  if (process.argv.includes('--dynamic')) dynamic.forEach((d) => console.log(d.text, '  <-', d.file));
}
