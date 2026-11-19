import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeToTokens, LiveTokenizer } from '@pierre/highlights';
import { parseImportsAndComments } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import { parser as jsParser } from '@lezer/javascript';
import type { LezerImport } from './lezerImports';
import { extractLezerImports } from './lezerImports';
import { measure } from './measure';

/**
 * Compares import extraction from a Lezer tree with docs-infra's hand-written
 * `parseImportsAndComments`, over every JS/TS file in docs-infra and its docs,
 * and measures what reusing the highlighting parse for it would cost.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const files = execFileSync('git', ['ls-files', 'packages/docs-infra/src', 'docs/app/docs-infra'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => /\.(?:[cm]?js|tsx?)$/.test(file));

const parsers = {
  ts: jsParser.configure({ dialect: 'ts' }),
  tsx: jsParser.configure({ dialect: 'ts jsx' }),
  js: jsParser.configure({ dialect: 'jsx' }),
};
const parserFor = (file: string) => {
  if (file.endsWith('.tsx')) {
    return parsers.tsx;
  }
  return file.endsWith('.ts') ? parsers.ts : parsers.js;
};

type Summary = Record<string, { names: string; positions: string }>;

function summarize(entries: Array<[string, { names: unknown[]; positions: unknown[] }]>): Summary {
  return Object.fromEntries(
    entries.map(([specifier, entry]) => [
      specifier,
      {
        names: JSON.stringify(
          entry.names
            .map((name) =>
              JSON.stringify(Object.fromEntries(Object.entries(name as object).sort())),
            )
            .sort((left, right) => left.localeCompare(right)),
        ),
        positions: JSON.stringify(entry.positions),
      },
    ]),
  );
}

function summarizeLezer(imports: LezerImport[]): Summary {
  const grouped = new Map<string, { names: unknown[]; positions: unknown[] }>();
  for (const found of imports) {
    const entry = grouped.get(found.source) ?? { names: [], positions: [] };
    grouped.set(found.source, entry);
    for (const name of found.names) {
      if (!entry.names.some((existing) => JSON.stringify(existing) === JSON.stringify(name))) {
        entry.names.push(name);
      }
    }
    entry.positions.push({ start: found.start, end: found.end });
  }
  return summarize([...grouped]);
}

const mismatches: string[] = [];
let specifierCount = 0;
let docsInfraMs = 0;
let lezerMs = 0;
let lezerExtractOnlyMs = 0;
let lezerHighlightMs = 0;

for (const file of files) {
  const source = readFileSync(repoRoot + file, 'utf8');
  const parser = parserFor(file);
  const expected = parseImportsAndComments(source, `/${file}`);
  const tree = parser.parse(source);
  const expectedSummary = summarize([
    ...Object.entries(expected.relative),
    ...Object.entries(expected.externals),
  ]);
  const actualSummary = summarizeLezer(extractLezerImports(tree, source).imports);
  specifierCount += Object.keys(expectedSummary).length;

  for (const specifier of new Set([
    ...Object.keys(expectedSummary),
    ...Object.keys(actualSummary),
  ])) {
    const left = expectedSummary[specifier];
    const right = actualSummary[specifier];
    if (!left || !right) {
      mismatches.push(`${file}: '${specifier}' only in ${left ? 'docs-infra' : 'Lezer'}`);
    } else if (left.names !== right.names) {
      mismatches.push(`${file}: '${specifier}' names ${left.names} vs ${right.names}`);
    } else if (left.positions !== right.positions) {
      mismatches.push(`${file}: '${specifier}' positions ${left.positions} vs ${right.positions}`);
    }
  }

  docsInfraMs += measure(() => parseImportsAndComments(source, `/${file}`), 20).medianMs;
  lezerMs += measure(() => extractLezerImports(parser.parse(source), source), 20).medianMs;
  lezerExtractOnlyMs += measure(() => extractLezerImports(tree, source), 20).medianMs;
  lezerHighlightMs += measure(
    () =>
      highlightCode(
        source,
        tree,
        classHighlighter,
        () => {},
        () => {},
      ),
    20,
  ).medianMs;
}

const totalKiB =
  files.reduce((sum, file) => sum + readFileSync(repoRoot + file, 'utf8').length, 0) / 1024;
const lines = [
  `# Import extraction: Lezer vs parseImportsAndComments`,
  ``,
  `${files.length} files (${totalKiB.toFixed(0)} KiB), ${specifierCount} imported specifiers per docs-infra.`,
  ``,
  `| step | total ms |`,
  `| :--- | ---: |`,
  `| docs-infra parseImportsAndComments | ${docsInfraMs.toFixed(1)} |`,
  `| Lezer parse + extract | ${lezerMs.toFixed(1)} |`,
  `| Lezer extract from an existing tree | ${lezerExtractOnlyMs.toFixed(1)} |`,
  `| Lezer highlight from the same tree | ${lezerHighlightMs.toFixed(1)} |`,
  ``,
  `## Mismatches (${mismatches.length})`,
  ``,
  ...mismatches.map((mismatch) => `- ${mismatch}`),
];

// @pierre/highlights has no syntax tree: the most structure it exposes is a
// token type per run, through `LiveTokenizer` records or a CSS-variable theme.
const sample = readFileSync(
  `${repoRoot}packages/docs-infra/src/pipeline/parseSource/parseSource.ts`,
  'utf8',
);
const live = new LiveTokenizer({
  lang: 'ts',
  code: sample,
  theme: { name: 'token-types', appearance: 'light', style: {}, cssVariables: true },
});
const records = live.getLineRecords(0);
const { tokens } = codeToTokens(sample.split('\n')[0], {
  lang: 'ts',
  theme: { name: 'token-types', appearance: 'light', style: {}, cssVariables: true },
});
live.dispose();
lines.push(
  '',
  '## @pierre/highlights token data for line 1',
  '',
  `LiveTokenizer records (${records.format}): ${[...records.data].map((word) => `${Math.floor(word / 2 ** 24)}@${word % 2 ** 24}`).join(' ')}`,
  '',
  `codeToTokens: ${tokens[0].map((token) => `${JSON.stringify(token.content)}=${token.color}`).join(' ')}`,
);

process.stdout.write(`${lines.join('\n')}\n`);
