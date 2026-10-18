// Pulls every user-facing string out of the UI source into docs/design-review/copy-deck.md, for
// the owner's design review (`node review/copy-deck.ts`, Node 23.6+).
// Heuristic: JSX text, text-bearing attributes, and sentence-like string literals.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCES = ['components', 'entrypoints', 'lib'];
const ATTRIBUTES = new Set([
  'aria-label',
  'placeholder',
  'title',
  'label',
  'description',
  'legend',
  'alt',
  'fallback',
]);
// Grouped by where it shows, in the order a reader meets the app.
const SCREENS: [string, RegExp][] = [
  [
    'Applications list, filters and status',
    /lib\/status\.ts|ApplicationList|ListControls|StatusChip|StatusSheet|Fab|App\.tsx/,
  ],
  [
    'Add / Edit form',
    /ApplicationForm|SourceField|Combobox|ResumeField|DuplicateWarning|applicationInput|formDefaults|lib\/applications\.ts/,
  ],
  ['Detail', /ApplicationDetail|StatusTimeline|MoreMenu/],
  ['Stats', /Stats|stats\.ts|WeeklyGoalCard|DateRangeFields/],
  ['Resumes', /resume|dropGuard/i],
  ['Settings', /Settings|deleteAll|settings\.ts|theme|privacy|notices/],
  ['Shared (sheets, toasts, tabs)', /Sheet|Toast|Tab|.*/],
];

const screenOf = (file: string) => SCREENS.find(([, pattern]) => pattern.test(file))![0];

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(rel);
    // icons.tsx is SVG path data.
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|^icons\.tsx$/.test(entry.name)
      ? [rel]
      : [];
  });
}

const sentenceLike = (text: string) =>
  /[A-Za-z]/.test(text) &&
  /^[A-Z“"'‘(…0-9]/.test(text) &&
  (/\s/.test(text) || /[.?!…]$/.test(text)) &&
  !/^[a-z-]+(\s[a-z0-9:/[\]().%_-]+)+$/.test(text) && // class lists
  !/[{};=<>]|^\w+\(|^\(prefers|https?:|\\/.test(text);

/** Inside `const X_LABELS = { … }`: single words (status names, ranges) count too. */
function inLabels(node: ts.Node, source: ts.SourceFile): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isVariableDeclaration(n)) return /LABELS$/.test(n.name.getText(source));
  }
  return false;
}

/** An Error subclass: its message is for logs, and the UI shows the fields it carries. */
const errorClass = (node: ts.Node) =>
  ts.isClassDeclaration(node) &&
  node.heritageClauses?.some((clause) => clause.types.some((t) => /Error$/.test(t.getText())));

const found = new Map<string, { text: string; where: string }[]>();
for (const file of SOURCES.flatMap(files)) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const add = (node: ts.Node, text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || !/[A-Za-z]/.test(clean)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const screen = screenOf(file);
    const list = found.get(screen) ?? [];
    if (!list.some((entry) => entry.text === clean))
      list.push({ text: clean, where: `${file}:${line}` });
    found.set(screen, list);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    // console.* and thrown errors (programmer errors; user-facing ones are typed, with fields)
    // aren't shown as they are.
    if (ts.isCallExpression(node) && /^console\./.test(node.expression.getText(source))) {
      return;
    }
    if (ts.isThrowStatement(node) || errorClass(node)) return;
    if (ts.isJsxText(node)) add(node, node.text);
    else if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText(source))) {
      const value = node.initializer;
      if (value && ts.isStringLiteral(value)) add(value, value.text);
      else if (value && ts.isJsxExpression(value) && value.expression) {
        const expr = value.expression;
        if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
          add(expr, expr.text);
        else if (ts.isTemplateExpression(expr)) add(expr, expr.getText(source).slice(1, -1));
      }
      return;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const className =
        ts.isJsxAttribute(node.parent) && node.parent.name.getText(source) === 'className';
      if ((sentenceLike(node.text) || inLabels(node, source)) && !className) add(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // Judged with each substitution as a word, so `${name} is back.` counts too.
      const words =
        node.head.text + node.templateSpans.map((span) => `Name${span.literal.text}`).join('');
      if (sentenceLike(words)) add(node, node.getText(source).slice(1, -1));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// The bundled pages' own copy: their titles and the text in their markup.
for (const dir of fs.readdirSync(path.join(ROOT, 'entrypoints'))) {
  const file = path.join('entrypoints', dir, 'index.html');
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lines = html.split('\n');
  const list = found.get(screenOf(file)) ?? [];
  // License texts (in <pre>) are quoted, not copy.
  const markup = html.replace(/<(script|style|pre)[\s\S]*?<\/\1>/g, '');
  for (const match of markup.matchAll(/>([^<>]+)</g)) {
    const text = match[1]!.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]/.test(text) || list.some((entry) => entry.text === text)) continue;
    const line = lines.findIndex((l) => l.includes(text.slice(0, 30))) + 1;
    list.push({ text, where: `${file}:${line || 1}` });
  }
  found.set(screenOf(file), list);
}

let out = `# Copy deck\n\nEvery user-facing string in the side panel and its pages, by screen, generated by \`review/copy-deck.ts\` from the source (so it can be regenerated after copy changes). \`\${…}\` is filled in at run time. The tone rule (spec §4.7): factual and encouraging; rejections never highlighted.\n\nSuggested changes for the review are in [README.md](README.md#copy).\n`;
for (const [screen] of SCREENS) {
  const list = found.get(screen);
  if (!list?.length) continue;
  out += `\n## ${screen}\n\n| Text | Where |\n| --- | --- |\n`;
  for (const { text, where } of list) {
    out += `| ${text.replace(/\|/g, '\\|')} | \`${where}\` |\n`;
  }
}
fs.writeFileSync(path.join(ROOT, 'docs/design-review/copy-deck.md'), out);
console.log(
  [...found.values()].reduce((n, list) => n + list.length, 0),
  'strings',
);
