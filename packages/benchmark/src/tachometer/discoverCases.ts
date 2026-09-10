import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { globby } from 'globby';
import { pathExists } from '../utils/path';

/**
 * Case discovery: the `tachometer.json` files under a harness's `src/` are the source of truth for
 * which benchmark cases exist and which pages they reference.
 *
 * Both the runner and the vite plugin read them through here, so there is exactly one notion of
 * "what pages exist". Discovery reads only the filesystem — which builds a case loads follows from
 * its shape rather than from git, so a plain `vite build` needs no checkout with history.
 */

/** Which of a run's two builds a variant loads. */
export type BuildRef = 'current' | 'baseline';

/**
 * What a case compares.
 *
 * `baseline` is the working tree against the baseline build: the regression case, and what a case
 * gets when it declares no variants of its own. `variants` is the pages the case names compared
 * against each other, every one of them built from the working tree.
 */
export type CaseComparison = 'baseline' | 'variants';

export interface Leaf {
  /** The config node whose `url` this is; rewritten in place once builds exist. */
  node: { url?: string };
  /** Page path relative to `src`, e.g. `data-grid-init/index.html`. */
  page: string;
  /** The build this variant loads. */
  ref: BuildRef;
  /** Everything after the page path: query and fragment, as written. */
  suffix: string;
}

export interface BenchmarkCase {
  /** The case name, as its benchmark declares it. */
  name: string;
  /** Absolute path to its `tachometer.json`. */
  configPath: string;
  /** The parsed config, mutated in place as urls are rewritten. */
  config: any;
  /** What the case compares. */
  comparison: CaseComparison;
  /** Every node that selects a page. */
  leaves: Leaf[];
  /** Variant names in order, as tachometer will report them; the first is the reference. */
  variants: string[];
  /** Measurement names, as tachometer will name them in its output. */
  measurements: string[];
}

export interface DiscoverCasesOptions {
  /** The harness package directory; cases live under its `src/`. */
  harnessDir: string;
  /**
   * Only include cases whose path under `src` contains one of these substrings,
   * case-insensitively.
   */
  filters?: string[];
}

/** The file that marks a directory under `src/` as a benchmark case. */
const CONFIG_NAME = 'tachometer.json';

/** Tachometer's expression when a `global` measurement does not name one. */
const DEFAULT_MEASUREMENT_EXPRESSION = 'window.tachometerResult';

/**
 * The name tachometer gives a measurement: an explicit `name`, else the expression, else the entry
 * name.
 *
 * With more than one measurement on a page, tachometer appends ` [<name>]` to each benchmark's
 * name, and results have to be paired back by that name — pairing by position would compare
 * unrelated measurements.
 */
export function measurementNameOf(measurement: any, measurementExpression?: string): string {
  if (typeof measurement === 'string') {
    // Tachometer's string shorthands. `callback` and `fcp` name their results the same way the
    // shorthand reads, but `global` expands to an *expression* measurement that is named by the
    // expression itself — so taking the shorthand at face value would look for a result that is
    // never emitted under that name.
    return measurement === 'global'
      ? (measurementExpression ?? DEFAULT_MEASUREMENT_EXPRESSION)
      : measurement;
  }
  if (measurement.name) {
    return measurement.name;
  }
  if (measurement.mode === 'expression') {
    return measurement.expression;
  }
  if (measurement.mode === 'callback') {
    return 'callback';
  }
  return measurement.entryName === 'first-contentful-paint' ? 'fcp' : measurement.entryName;
}

/**
 * Flattens a benchmark's `expand` tree into the list of benchmarks it stands for, the way tachometer
 * does before it reads anything else.
 *
 * `expand` is recursive and an expansion is merged over its parent, so the nearest value of every
 * field wins — `url`, `name`, `measurement`, `browser` alike. Doing that merge once, here, is what
 * keeps the rest of discovery dealing in whole benchmarks: per-field inheritance is a rule that only
 * has value while it agrees with tachometer's exactly, and re-deriving it once per field is how the
 * two drift apart.
 *
 * `expand` itself is dropped. Tachometer leaves the parent's on the merged object, where it is inert
 * because expansion has already happened — but the config written from this is parsed afresh, and a
 * benchmark still carrying `expand` would be expanded a second time.
 */
function flattenExpansions(benchmark: any): any[] {
  const { expand, ...rest } = benchmark;
  if (!Array.isArray(expand) || expand.length === 0) {
    return [rest];
  }
  return expand.flatMap((child) => flattenExpansions(child).map((leaf) => ({ ...rest, ...leaf })));
}

/**
 * Resolves one variant's url into the source page it references and whatever follows it.
 *
 * The path is carried through as written rather than through `URL`: these urls are relative to their
 * own config's directory and traverse out of it (`../row-updates/index.html?throttle=16`), and `URL`
 * would clamp that traversal against whatever base it was given. Everything after the path belongs
 * to the page and survives the rewrite verbatim, or a parameterised benchmark would silently run its
 * defaults.
 */
async function parseLeafUrl(
  url: string,
  configDir: string,
  srcDir: string,
): Promise<{ page: string; suffix: string }> {
  const [pathPart] = url.split(/[?#]/);
  const suffix = url.slice(pathPart.length);
  const absolute = path.resolve(configDir, decodeURIComponent(pathPart));

  const page = path.relative(srcDir, absolute);
  if (page.startsWith('..') || path.isAbsolute(page)) {
    throw new Error(`Benchmark url "${url}" resolves outside ${srcDir}.`);
  }
  if (!(await pathExists(absolute))) {
    throw new Error(`Benchmark url "${url}" points at a missing page (${absolute}).`);
  }
  return { page, suffix };
}

/**
 * Every directory under `srcDir` that holds a `tachometer.json`, as a posix path relative to it.
 *
 * Nested rather than flat, so a harness can group its cases in folders — which is the whole of the
 * partitioning story: the filter matches these paths, and nothing else has to understand what a
 * folder means.
 */
async function findCaseLocations(srcDir: string): Promise<string[]> {
  const configs = await globby(`**/${CONFIG_NAME}`, { cwd: srcDir });
  return (
    configs
      // `dirname` gives `.` for a config sitting directly in `src`; that case's location is the root.
      .map((config) => (path.posix.dirname(config) === '.' ? '' : path.posix.dirname(config)))
      // Sorted so a run's case order — and therefore its report — does not depend on the order the
      // filesystem happened to return.
      .sort()
  );
}

/**
 * Reads every `tachometer.json` under `src/` (optionally filtered by location) and resolves the page
 * each of its variants loads.
 *
 * `expand` decides what a case compares. A benchmark that declares one owns its variant axis, and
 * every variant loads the working tree — a comparison between pages, such as one library against
 * another. A benchmark without one is expanded into `[current]` and `[baseline]` over the same page,
 * which is the regression case.
 */
export async function discoverCases(options: DiscoverCasesOptions): Promise<BenchmarkCase[]> {
  const { harnessDir, filters = [] } = options;
  const srcDir = path.join(harnessDir, 'src');

  const located = await findCaseLocations(srcDir);
  // Matched case-insensitively against the location, the way vitest matches its file filters: a
  // folder name selects everything under it without the filter having to know what a folder means.
  const selected = located.filter(
    (location) =>
      filters.length === 0 ||
      filters.some((filter) => location.toLowerCase().includes(filter.toLowerCase())),
  );

  if (selected.length === 0) {
    throw new Error(
      filters.length > 0
        ? `No benchmark case under ${srcDir} matches ${filters.map((filter) => `"${filter}"`).join(', ')}.`
        : `No benchmark case with a ${CONFIG_NAME} found under ${srcDir}.`,
    );
  }

  const configs = await Promise.all(
    selected.map(async (location) => {
      const configPath = path.join(srcDir, location, CONFIG_NAME);
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      // `$schema` is for editors; tachometer rejects it in a config it is handed.
      delete config.$schema;
      // The benchmark names itself, so a case keeps its identity wherever its folder is moved to,
      // and the ` [<variant>]` prefix that tachometer builds from that name is strippable for
      // display by construction rather than by the folder happening to agree with it.
      const name: string = config.benchmarks?.[0]?.name ?? path.basename(location);
      return { name, configPath, config };
    }),
  );

  const byName = new Map<string, string>();
  for (const entry of configs) {
    const clash = byName.get(entry.name);
    if (clash) {
      throw new Error(
        `Two benchmark cases are both named "${entry.name}": ${clash} and ${entry.configPath}. ` +
          `Names identify a case in the report and in its results file, so they have to be unique.`,
      );
    }
    byName.set(entry.name, entry.configPath);
  }

  const cases: BenchmarkCase[] = [];
  for (const { name, configPath, config } of configs) {
    const configDir = path.dirname(configPath);

    const measurements = new Set<string>();
    const nodes: Array<{ node: any; ref: BuildRef }> = [];
    for (const benchmark of config.benchmarks ?? []) {
      // A benchmark need not name itself, and the case name is the same fallback its own name gets
      // — without it the auto-expanded variants would read "undefined [current]". Set before
      // flattening so every benchmark it expands to inherits it.
      benchmark.name ??= name;
      // `measurement` may be a single entry or a list; a page with several is exactly the case
      // whose results have to be paired by measurement name rather than by position.
      for (const measurement of [benchmark.measurement ?? 'callback'].flat()) {
        measurements.add(measurementNameOf(measurement, benchmark.measurementExpression));
      }

      const declaresVariants = Array.isArray(benchmark.expand) && benchmark.expand.length > 0;
      const expanded = flattenExpansions(benchmark);
      if (declaresVariants) {
        for (const node of expanded) {
          nodes.push({ node, ref: 'current' });
        }
      } else {
        // Without `expand` exactly one benchmark comes back, and the same page is measured twice.
        const [base] = expanded;
        if (base.url === undefined) {
          throw new Error(`Benchmark "${benchmark.name}" in ${configPath} has no "url".`);
        }
        nodes.push(
          { node: { ...base, name: `${benchmark.name} [current]` }, ref: 'current' },
          { node: { ...base, name: `${benchmark.name} [baseline]` }, ref: 'baseline' },
        );
      }
    }

    // A declared `expand` tree may bottom out in a variant that names no url and inherits none.
    for (const { node } of nodes) {
      if (node.url === undefined) {
        throw new Error(
          `Benchmark "${node.name}" in ${configPath} expands to a variant with no "url".`,
        );
      }
    }

    // The flattened list is what tachometer is handed: it expands to exactly this, and every later
    // step — the url rewrite, the browser defaults — then addresses one whole benchmark at a time.
    config.benchmarks = nodes.map((entry) => entry.node);

    // eslint-disable-next-line no-await-in-loop
    const resolved = await Promise.all(
      nodes.map((entry) => parseLeafUrl(entry.node.url, configDir, srcDir)),
    );

    cases.push({
      name,
      configPath,
      config,
      comparison: nodes.some((entry) => entry.ref === 'baseline') ? 'baseline' : 'variants',
      leaves: nodes.map((entry, index) => ({ ...entry, ...resolved[index] })),
      variants: nodes.map((entry) => entry.node.name as string),
      measurements: [...measurements],
    });
  }
  return cases;
}

/** The distinct pages referenced by a set of cases, as paths relative to `src`, sorted. */
export function pagesOf(cases: BenchmarkCase[]): string[] {
  return [...new Set(cases.flatMap((entry) => entry.leaves.map((leaf) => leaf.page)))].sort();
}
