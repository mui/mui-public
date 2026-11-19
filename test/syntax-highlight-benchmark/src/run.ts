import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { toHtml } from 'hast-util-to-html';
import { measureBundles, ONIGURUMA_WASM } from './bundle';
import type { BundleEntry, BundleSize } from './bundle';
import { COMPARABLE_CATEGORIES } from './categories';
import { renderComparison } from './compareHtml';
import { loadCorpus } from './corpus';
import type { Engine } from './engine';
import { BASELINE_ENGINE, ENGINE_LOADERS } from './engines';
import { compareCategories, jaccard, sumCounts } from './fidelity';
import type { FidelityCounts } from './fidelity';
import { countElements, textOf } from './hast';
import { LANGUAGES } from './languages';
import { measure, median } from './measure';

const { values: args } = parseArgs({
  options: {
    engines: { type: 'string', default: Object.keys(ENGINE_LOADERS).join(',') },
    'cold-runs': { type: 'string', default: '5' },
    'skip-bundles': { type: 'boolean', default: false },
  },
});

const BUNDLES: Record<string, BundleEntry[]> = {
  'starry-night': [
    {
      label: 'starry-night, tsx grammar only',
      entry: 'starryNightTsx.ts',
      external: ONIGURUMA_WASM,
    },
    {
      label: 'starry-night, all 11 grammars',
      entry: 'starryNightAll.ts',
      external: ONIGURUMA_WASM,
    },
  ],
  highlights: [
    { label: '@pierre/highlights (all languages, Wasm inlined)', entry: 'highlights.ts' },
  ],
};

const resultsDir = fileURLToPath(new URL('../results/', import.meta.url));
const engineKeys = args.engines.split(',');
const corpus = loadCorpus();
const engines = await Promise.all(
  engineKeys.map(async (key): Promise<[string, Engine]> => {
    const engine = await ENGINE_LOADERS[key]();
    await engine.init();
    return [key, engine];
  }),
);
const baseline = engines.find(([key]) => key === BASELINE_ENGINE)?.[1];

const fmt = (value: number | undefined, digits = 2) =>
  value === undefined ? '–' : value.toFixed(digits);
const pct = (value: number | undefined) =>
  value === undefined ? '–' : `${(value * 100).toFixed(1)}%`;
const table = (header: string[], rows: string[][]) =>
  [header, header.map((_, index) => (index === 0 ? ':---' : '---:')), ...rows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');

const report: string[] = [];
const section = (title: string, ...parts: string[]) => {
  report.push([`## ${title}`, ...parts].join('\n\n'));
};
const json: Record<string, unknown> = {};

const cpu = `${cpus()[0]?.model ?? 'unknown CPU'} (${cpus().length} cores)`;
report.push(
  [
    '# Syntax highlighting benchmark',
    `Node ${process.version}, ${cpu}, ${Math.round(totalmem() / 2 ** 30)} GiB, ${process.platform}.`,
    `Engines: ${engines.map(([, engine]) => `${engine.name} ${engine.version}`).join(', ')}.`,
  ].join('\n\n'),
);

// Every engine must reproduce the source text exactly.
const textMismatches = engines.flatMap(([, engine]) =>
  corpus
    .filter((sample) => textOf(engine.highlight(sample.source, sample.language)) !== sample.source)
    .map((sample) => `- ${engine.name} / ${sample.id}`),
);
if (textMismatches.length > 0) {
  section('Text round-trip failures', textMismatches.join('\n'));
}

console.error('Measuring warm highlighting…');
const warm: Record<string, Record<string, number>> = {};
for (const sample of corpus) {
  warm[sample.id] = {};
  for (const [key, engine] of engines) {
    warm[sample.id][key] = measure(() => engine.highlight(sample.source, sample.language)).medianMs;
  }
}
const lineCount = (source: string) => source.split('\n').length;
const totalKiB = corpus.reduce((sum, sample) => sum + sample.source.length, 0) / 1024;
const warmRows = corpus.map((sample) => {
  const base = warm[sample.id][BASELINE_ENGINE];
  return [
    sample.id,
    String(lineCount(sample.source)),
    ...engines.map(([key]) => {
      const ms = warm[sample.id][key];
      return base && key !== BASELINE_ENGINE ? `${fmt(ms, 3)} (${fmt(base / ms, 1)}×)` : fmt(ms, 3);
    }),
  ];
});
warmRows.push([
  '**total**',
  String(corpus.reduce((sum, sample) => sum + lineCount(sample.source), 0)),
  ...engines.map(([key]) => {
    const ms = corpus.reduce((sum, sample) => sum + warm[sample.id][key], 0);
    return `**${fmt(ms, 2)}** (${fmt(totalKiB / (ms / 1000), 0)} KiB/s)`;
  }),
]);
section(
  'Warm highlighting (median ms per call, source → HAST)',
  `Speed-up relative to ${BASELINE_ENGINE} in parentheses.`,
  table(['sample', 'lines', ...engines.map(([, engine]) => engine.name)], warmRows),
);
json.warm = warm;

console.error('Measuring cold start…');
const coldRuns = Number(args['cold-runs']);
const cold: Record<string, unknown> = {};
const coldRows = engines.map(([key, engine]) => {
  const runs = Array.from({ length: coldRuns }, () =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [...process.execArgv, fileURLToPath(new URL('./cold.ts', import.meta.url)), key],
        { encoding: 'utf8' },
      ),
    ),
  );
  const summary = {
    initMs: median(runs.map((run) => run.initMs)),
    firstHighlightMs: median(runs.map((run) => run.firstHighlightMs)),
    rssGrowthMiB: median(runs.map((run) => run.peakRssMiB - run.baselineRssMiB)),
  };
  cold[key] = summary;
  return [
    engine.name,
    fmt(summary.initMs, 1),
    fmt(summary.firstHighlightMs, 1),
    fmt(summary.initMs + summary.firstHighlightMs, 1),
    fmt(summary.rssGrowthMiB, 0),
  ];
});
section(
  `Cold start (median of ${coldRuns} fresh processes)`,
  'Import + init loads every docs-infra language. Memory is peak RSS growth after highlighting the whole corpus once.',
  table(
    [
      'engine',
      'import + init (ms)',
      'first 12-line tsx highlight (ms)',
      'total (ms)',
      'peak RSS growth (MiB)',
    ],
    coldRows,
  ),
);
json.cold = cold;

// Precomputed HAST is serialized into the page, so the token count drives payload size.
const outputRows = engines.map(([, engine]) => {
  const roots = corpus.map((sample) => engine.highlight(sample.source, sample.language));
  const elements = roots.reduce((sum, root) => sum + countElements(root), 0);
  const htmlBytes = roots.reduce((sum, root) => sum + Buffer.byteLength(toHtml(root)), 0);
  return [engine.name, String(elements), fmt(htmlBytes / 1024, 0)];
});
section('Output size (whole corpus)', table(['engine', 'elements', 'HTML (KiB)'], outputRows));

if (baseline) {
  const fidelity: Record<string, Partial<Record<string, FidelityCounts>>> = {};
  for (const [key, engine] of engines) {
    if (engine.categorize === baseline.categorize) {
      continue;
    }
    const byLanguage: Partial<Record<string, FidelityCounts>> = {};
    for (const sample of corpus) {
      byLanguage[sample.language] = compareCategories(
        sample.source,
        sample.language,
        { engine: baseline, root: baseline.highlight(sample.source, sample.language) },
        { engine, root: engine.highlight(sample.source, sample.language) },
        byLanguage[sample.language],
      );
    }
    fidelity[key] = byLanguage;
    const rows = LANGUAGES.flatMap((language) => {
      const counts = byLanguage[language];
      if (!counts) {
        return [];
      }
      return [
        [
          engine.unsupported.includes(language) ? `${language} (unsupported)` : language,
          ...COMPARABLE_CATEGORIES.map((category) => pct(jaccard(counts[category]))),
          `**${pct(jaccard(sumCounts(counts)))}**`,
        ],
      ];
    });
    section(
      `Token agreement: ${engine.name} vs ${baseline.name}`,
      'Intersection over union of non-whitespace characters each engine assigns to a category. Only categories both taxonomies define the same way are compared; a dash means neither engine uses the category for that language.',
      table(['language', ...COMPARABLE_CATEGORIES, 'overall'], rows),
    );
  }
  json.fidelity = fidelity;
}

if (!args['skip-bundles']) {
  console.error('Measuring bundle sizes…');
  const bundles: BundleSize[] = await measureBundles(
    engineKeys.flatMap((key) => BUNDLES[key] ?? []),
  );
  section(
    'Browser payload (minified, KiB)',
    table(
      ['bundle', 'raw', 'gzip', 'brotli', 'note'],
      bundles.map((size) => [
        size.label,
        fmt(size.rawKiB, 1),
        fmt(size.gzipKiB, 1),
        fmt(size.brotliKiB, 1),
        size.note ?? '',
      ]),
    ),
  );
  json.bundles = bundles;
}

mkdirSync(resultsDir, { recursive: true });
writeFileSync(`${resultsDir}report.md`, `${report.join('\n\n')}\n`);
writeFileSync(`${resultsDir}results.json`, `${JSON.stringify(json, null, 2)}\n`);
writeFileSync(
  `${resultsDir}compare.html`,
  renderComparison(
    engines.filter(([key]) => key !== 'docs-infra').map(([, engine]) => engine),
    corpus.filter((sample) => !sample.id.includes('snippet')),
  ),
);
process.stdout.write(`${report.join('\n\n')}\n`);
console.error(`\nWrote ${resultsDir}{report.md,results.json,compare.html}`);
