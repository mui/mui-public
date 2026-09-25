import * as path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { globby } from 'globby';
import { matchesFilters } from './discoverCases';

/**
 * `*.bench.tsx` files: `benchmark()` cases, the same files Vitest runs, measured by the interleaved
 * engine instead. Each file gets a generated page that loads it with `@mui/internal-benchmark`
 * swapped for the page runtime, so the file itself needs no page, config or entry of its own.
 */

/** Where the generated pages live, under `src/`. Ignored from the inside, like `.tachometer/`. */
export const BENCH_PAGES_DIR = '__bench__';

const BENCH_FILE_PATTERN = '**/*.bench.tsx';

export interface BenchFile {
  /** The benchmark file, posix, relative to `src`. */
  file: string;
  /** The generated page that runs it, posix, relative to `src`. */
  page: string;
}

function benchFileOf(file: string): BenchFile {
  const slug = file.replace(/\.bench\.tsx$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return { file, page: `${BENCH_PAGES_DIR}/${slug}.html` };
}

/** The `*.bench.tsx` files under `src/`, optionally filtered by path, sorted. */
export async function discoverBenchFiles(options: {
  harnessDir: string;
  filters?: string[];
}): Promise<BenchFile[]> {
  const { harnessDir, filters = [] } = options;
  const files = await globby(BENCH_FILE_PATTERN, {
    cwd: path.join(harnessDir, 'src'),
    ignore: [`${BENCH_PAGES_DIR}/**`],
  });
  return files
    .filter((file) => matchesFilters(file, filters))
    .sort()
    .map(benchFileOf);
}

function pageHtml(benchFile: BenchFile, entry: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${benchFile.file}</title>
  </head>
  <body>
    <script type="module" src="./${entry}"></script>
  </body>
</html>
`;
}

// The benchmark file first: its `benchmark()` calls register while it evaluates, and the page only
// reports itself ready once every case is known.
function pageEntry(benchFile: BenchFile): string {
  // Extensionless, the way the harness's own imports are written; vite resolves the `.tsx`.
  const relative = path.posix
    .relative(path.posix.dirname(benchFile.page), benchFile.file)
    .replace(/\.tsx$/, '');
  const specifier = relative.startsWith('../') ? relative : `./${relative}`;
  return `import '${specifier}';
import { markPageReady } from '@mui/internal-benchmark/page';

void markPageReady();
`;
}

/**
 * Writes a page per benchmark file into `src/__bench__/`, replacing whatever was there, so pages
 * of deleted files do not linger as build inputs.
 */
export async function writeBenchPages(harnessDir: string, benchFiles: BenchFile[]): Promise<void> {
  const pagesDir = path.join(harnessDir, 'src', BENCH_PAGES_DIR);
  await rm(pagesDir, { recursive: true, force: true });
  if (benchFiles.length === 0) {
    return;
  }
  await mkdir(pagesDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(pagesDir, '.gitignore'), '*\n'),
    ...benchFiles.flatMap((benchFile) => {
      const html = path.join(harnessDir, 'src', benchFile.page);
      const entry = `${path.basename(benchFile.page, '.html')}.entry.ts`;
      return [
        writeFile(html, pageHtml(benchFile, entry)),
        writeFile(path.join(path.dirname(html), entry), pageEntry(benchFile)),
      ];
    }),
  ]);
}
