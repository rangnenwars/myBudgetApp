// Finds the English text a person can see in the app's source, using the TypeScript parser.
// Used by `npm run i18n:missing` and by utils/__tests__/i18nCoverage.test.ts, so a new screen
// cannot ship with text that has no Hindi.
//
// What counts as user-facing text:
//  - text written between JSX tags,
//  - string props such as placeholder, label, title, message, hint, description,
//  - other string literals that read like a sentence or a label (see looksLikeText).
// Strings that are code, not text (route names, keys, enum values, colours) are skipped by
// looksLikeText or listed in utils/i18nIgnore.ts.

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'components', 'context', 'utils', 'constants'];
// Files that hold translations or tooling, never user-facing text themselves.
const SKIP_FILE = /(__tests__|\.test\.|i18n|theme\.ts|types\.ts|api\.ts|tokenStorage|database\.ts|calendar\.ts)/;
const TEXT_PROPS = new Set(['placeholder', 'label', 'title', 'message', 'hint', 'description', 'subtitle', 'text', 'emptyText', 'confirmLabel']);

const decode = (s) =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

// A literal that is probably shown to a person: starts with a capital letter and has a lowercase
// letter after it, or contains a space, and is not code-like.
const looksLikeText = (s) => {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (/^[a-z0-9_\-./:#@?=&%+]+$/.test(t)) return false; // identifiers, paths, urls, enums
  if (/^[A-Z0-9_]+$/.test(t)) return false; // CONSTANTS
  if (/^(https?:|\/|\.{1,2}\/|#[0-9a-f]{3,8}$|rgba?\()/i.test(t)) return false;
  if (/^[a-z][A-Za-z0-9]*$/.test(t)) return false; // camelCase identifiers
  if (/^\w+(\.\w+)+$/.test(t)) return false; // dotted keys
  return /^[A-Z][a-z]/.test(t) || /\s/.test(t) || /^[A-Z][a-z]+$/.test(t);
};

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !SKIP_FILE.test(full.replace(ROOT, ''))) {
      yield full;
    }
  }
}

function extractFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = []; // { text, kind, line }
  const dynamic = []; // template strings with ${}

  const line = (node) => src.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const add = (s, kind, node) => {
    const c = collapse(s);
    if (c) found.push({ text: c, kind, line: line(node) });
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const c = collapse(decode(node.getText()));
      if (/[A-Za-z]/.test(c)) add(c, 'jsx', node);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const skip = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportEqualsDeclaration(p) || (ts.isLiteralTypeNode(p) && true) || ts.isEnumMember(p);
      if (!skip) {
        if (ts.isJsxAttribute(p)) {
          if (TEXT_PROPS.has(p.name.getText()) && /[A-Za-z]/.test(node.text)) add(node.text, 'prop', node);
        } else if (ts.isPropertyAssignment(p) && p.initializer === node && /^(key|name|icon|color|href|pathname|route|type|kind|id|style|testID|screen|bg|fontFamily)$/.test(p.name.getText())) {
          // code, not text
        } else if (ts.isElementAccessExpression(p) || ts.isCaseClause(p) || ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText())) {
          // comparisons and lookups
        } else if (looksLikeText(node.text)) {
          add(node.text, 'literal', node);
        }
      }
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s, i) => `{${i}}` + s.literal.text)].join('');
      if (/[A-Za-z]{2,}/.test(parts.replace(/\{\d+\}/g, ''))) dynamic.push({ text: collapse(parts), line: line(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return { found, dynamic };
}

function extractAll() {
  const out = {}; // text -> [{file,line,kind}]
  const dynamic = [];
  for (const d of DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const { found, dynamic: dyn } = extractFile(file);
      for (const f of found) (out[f.text] ||= []).push({ file: rel, line: f.line, kind: f.kind });
      for (const x of dyn) dynamic.push({ ...x, file: rel });
    }
  }
  return { strings: out, dynamic };
}

const IGNORE_FILE = path.join(__dirname, 'i18nIgnore.json');
/** Text that is code, not something a person reads (exact strings), from scripts/i18nIgnore.json. */
const loadIgnore = () => (fs.existsSync(IGNORE_FILE) ? new Set(JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf8'))) : new Set());

module.exports = { extractAll, looksLikeText, collapse, loadIgnore };

if (require.main === module) {
  const { strings, dynamic } = extractAll();
  const keys = Object.keys(strings).sort();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ strings, dynamic }, null, 1));
  } else {
    console.log(`${keys.length} distinct texts, ${dynamic.length} template strings with values`);
    if (process.argv.includes('--list')) for (const k of keys) console.log(JSON.stringify(k), '  <-', strings[k][0].file + ':' + strings[k][0].line);
    if (process.argv.includes('--dynamic')) for (const d of dynamic) console.log(JSON.stringify(d.text), '  <-', d.file + ':' + d.line);
  }
}
