import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOutput, ONIGURUMA_WASM, sizes } from './bundle';
import type { BundleSize } from './bundle';
import { LANGUAGES } from './languages';
import type { Language } from './languages';
import { packageDir } from './packageVersion';

/**
 * Browser download for client-side highlighting with lazy per-language
 * loading: the engine core every page pays once, then what each language adds.
 */
type Chunks = Awaited<ReturnType<typeof buildOutput>>;
type Chunk = Extract<Chunks[number], { type: 'chunk' }>;

const bundlePath = (name: string) => fileURLToPath(new URL(`./bundles/${name}`, import.meta.url));

function closure(chunks: Map<string, Chunk>, roots: string[]): Set<string> {
  const seen = new Set<string>();
  const visit = (fileName: string) => {
    if (seen.has(fileName)) {
      return;
    }
    seen.add(fileName);
    chunks.get(fileName)?.imports.forEach(visit);
  };
  roots.forEach(visit);
  return seen;
}

interface LazyEngine {
  label: string;
  entry: string;
  /** Matches the module that a language's dynamic import resolves to. */
  languageModule: (language: Language) => RegExp;
  /** Languages that need others registered at runtime, outside the import graph. */
  runtimeDependencies?: Partial<Record<Language, Language[]>>;
  coreAssets?: string[];
}

const STARRY_SCOPES: Record<Language, string> = {
  js: 'source.js',
  ts: 'source.ts',
  tsx: 'source.tsx',
  json: 'source.json',
  md: 'text.md',
  mdx: 'source.mdx',
  html: 'text.html.basic',
  css: 'source.css',
  sh: 'source.shell',
  yaml: 'source.yaml',
  diff: 'source.diff',
};

const ENGINES: LazyEngine[] = [
  {
    label: 'starry-night',
    entry: 'starryNightLazy.ts',
    languageModule: (language) =>
      new RegExp(`/lang/${STARRY_SCOPES[language].replace('.', '\\.')}\\.js$`),
    runtimeDependencies: { mdx: ['tsx'] },
    coreAssets: [ONIGURUMA_WASM.path],
  },
  {
    label: 'CodeMirror (Lezer)',
    entry: 'codemirrorLazy.ts',
    languageModule: (language) => new RegExp(`/lezer/${language}\\.ts$`),
  },
];

const SCENARIOS: Array<[string, Language[]]> = [
  ['tsx only', ['tsx']],
  ['tsx + css + sh (typical demo page)', ['tsx', 'css', 'sh']],
  ['all 11 languages', [...LANGUAGES]],
];

const rows: string[][] = [];
const fmt = (size: BundleSize) => [size.gzipKiB.toFixed(1), size.brotliKiB.toFixed(1)];

for (const engine of ENGINES) {
  // eslint-disable-next-line no-await-in-loop -- vite builds share global state; run them one at a time
  const output = await buildOutput(bundlePath(engine.entry));
  const chunks = new Map(
    output
      .filter((item): item is Chunk => item.type === 'chunk')
      .map((item) => [item.fileName, item]),
  );
  const entryChunk = [...chunks.values()].find((chunk) => chunk.isEntry)!;
  const core = closure(chunks, [entryChunk.fileName]);
  const contentsOf = (fileNames: Iterable<string>) =>
    [...fileNames].map((fileName) => Buffer.from(chunks.get(fileName)!.code));
  const coreAssets = (engine.coreAssets ?? []).map((path) => readFileSync(path));
  const languageChunk = (language: Language) => {
    const found = entryChunk.dynamicImports.find((fileName) =>
      (chunks.get(fileName)?.moduleIds ?? []).some((id) =>
        engine.languageModule(language).test(id),
      ),
    );
    if (!found) {
      throw new Error(`No chunk for ${language} in ${engine.label}`);
    }
    return found;
  };
  const languageFiles = (languages: Language[]) => {
    const withDependencies = languages.flatMap((language) => [
      language,
      ...(engine.runtimeDependencies?.[language] ?? []),
    ]);
    const files = closure(chunks, withDependencies.map(languageChunk));
    core.forEach((fileName) => files.delete(fileName));
    return files;
  };

  rows.push([`**${engine.label}** core`, ...fmt(sizes('', [...contentsOf(core), ...coreAssets]))]);
  for (const language of LANGUAGES) {
    rows.push([`+ ${language}`, ...fmt(sizes('', contentsOf(languageFiles([language]))))]);
  }
  for (const [label, languages] of SCENARIOS) {
    rows.push([
      `= ${label}`,
      ...fmt(
        sizes('', [...contentsOf(core), ...coreAssets, ...contentsOf(languageFiles(languages))]),
      ),
    ]);
  }
}

const highlightsDir = packageDir('@pierre/highlights');
const highlightsInline = await buildOutput(bundlePath('highlightsSeparateWasm.ts'));
const highlightsSeparate = await buildOutput(bundlePath('highlightsSeparateWasm.ts'), [
  { find: /^\.\/highlights\.wasm\.mjs$/, replacement: bundlePath('emptyWasm.ts') },
]);
const codeOf = (output: Chunks) =>
  output.map((item) => Buffer.from(item.type === 'chunk' ? item.code : item.source));
rows.push(
  [
    '**@pierre/highlights**, Wasm inlined as base64 (published default)',
    ...fmt(sizes('', codeOf(highlightsInline))),
  ],
  [
    '**@pierre/highlights**, Wasm fetched as a file',
    ...fmt(
      sizes('', [
        ...codeOf(highlightsSeparate),
        readFileSync(join(highlightsDir, 'dist/highlights.wasm')),
      ]),
    ),
  ],
);

const table = [
  '| download | gzip KiB | brotli KiB |',
  '| :--- | ---: | ---: |',
  ...rows.map((row) => `| ${row.join(' | ')} |`),
].join('\n');
const resultsDir = fileURLToPath(new URL('../results/', import.meta.url));
mkdirSync(resultsDir, { recursive: true });
writeFileSync(`${resultsDir}payload.md`, `# Browser payload with lazy languages\n\n${table}\n`);
process.stdout.write(`${table}\n`);
