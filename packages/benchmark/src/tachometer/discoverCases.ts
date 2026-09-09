import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { globby } from 'globby';
import { pathExists } from '../utils/path';
import { parseRefToken } from './refs';
import type { ResolvedRef } from './refs';

/**
 * Case discovery: the `tachometer.json` files under a harness's `src/` are the source of truth for
 * which benchmark cases exist and which pages they reference.
 *
 * Both the runner and the vite plugin read them through here, so there is exactly one notion of
 * "what pages exist". The plugin passes no `resolveRef`, which keeps discovery free of git — a
 * plain `vite build` must not require a checkout with full history.
 */

export interface Leaf {
  /** The config node whose `url` this is; rewritten in place once builds exist. */
  node: { url?: string };
  /** Page path relative to `src`, e.g. `data-grid-init/index.html`. */
  page: string;
  /** The resolved ref, or null when discovery ran without `resolveRef`. */
  ref: ResolvedRef | null;
  /** Everything after the page path once `ref` was consumed: remaining query plus any fragment. */
  suffix: string;
}

export interface CaseVariant {
  /** The variant's name, as tachometer will report it. */
  name: string;
  /** The ref this variant loads, or null when refs were not resolved. */
  refId: string | null;
}

export interface BenchmarkCase {
  /** The case name, as its benchmark declares it. */
  name: string;
  /** Absolute path to its `tachometer.json`. */
  configPath: string;
  /** The parsed config, mutated in place as urls are rewritten. */
  config: any;
  /** Every node that selects a page. */
  leaves: Leaf[];
  /** Declared variants in order; the first is every comparison's reference. */
  variants: CaseVariant[];
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
  /** Resolves a ref token. Omit to skip resolution entirely (no git). */
  resolveRef?: (token?: string) => ResolvedRef;
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
 * Resolves one leaf url into the source page it references, the ref it selects, and any leftovers.
 *
 * `ref` selects the build and is consumed here; everything else belongs to the page and has to
 * survive the rewrite, or a parameterised benchmark would silently run its defaults.
 */
async function parseLeafUrl(
  url: string,
  configDir: string,
  srcDir: string,
  resolveRef: ((token?: string) => ResolvedRef) | undefined,
): Promise<{ page: string; ref: ResolvedRef | null; suffix: string }> {
  const parsed = new URL(url, pathToFileURL(path.join(configDir, path.sep)));
  const token = parsed.searchParams.get('ref') ?? undefined;
  // Validate the grammar even when not resolving, so a typo fails the build rather than silently
  // building a page the runner would later reject.
  parseRefToken(token);
  const ref = resolveRef ? resolveRef(token) : null;
  const absolute = decodeURIComponent(parsed.pathname);

  parsed.searchParams.delete('ref');
  const search = parsed.searchParams.toString();
  const suffix = `${search ? `?${search}` : ''}${parsed.hash}`;

  const page = path.relative(srcDir, absolute);
  if (page.startsWith('..') || path.isAbsolute(page)) {
    throw new Error(`Benchmark url "${url}" resolves outside ${srcDir}.`);
  }
  if (!(await pathExists(absolute))) {
    throw new Error(`Benchmark url "${url}" points at a missing page (${absolute}).`);
  }
  return { page, ref, suffix };
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
 * Reads every `tachometer.json` under `src/` (optionally filtered by location), expands the sugar
 * for cases that declare no variants of their own, and resolves each leaf's page and ref.
 *
 * A benchmark with no `expand` is the common regression case: it is expanded into `[current]` (the
 * working tree) versus `[baseline]`. A benchmark that declares its own `expand` owns its variant
 * axis — only the refs its leaves reference are resolved.
 */
export async function discoverCases(options: DiscoverCasesOptions): Promise<BenchmarkCase[]> {
  const { harnessDir, filters = [], resolveRef } = options;
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
    const benchmarks: any[] = [];
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
      if (!Array.isArray(benchmark.expand) || benchmark.expand.length === 0) {
        const base = benchmark.url;
        if (base === undefined) {
          throw new Error(`Benchmark "${benchmark.name}" in ${configPath} has no "url".`);
        }
        const separator = base.includes('?') ? '&' : '?';
        benchmark.expand = [
          { name: `${benchmark.name} [current]`, url: base },
          { name: `${benchmark.name} [baseline]`, url: `${base}${separator}ref=baseline` },
        ];
      }
      benchmarks.push(...flattenExpansions(benchmark));
    }

    // A declared `expand` tree may bottom out in a variant that names no url and inherits none.
    for (const benchmark of benchmarks) {
      if (benchmark.url === undefined) {
        throw new Error(
          `Benchmark "${benchmark.name}" in ${configPath} expands to a variant with no "url".`,
        );
      }
    }

    // The flattened list is what tachometer is handed: it expands to exactly this, and every later
    // step — the url rewrite, the browser defaults — then addresses one whole benchmark at a time.
    config.benchmarks = benchmarks;

    // eslint-disable-next-line no-await-in-loop
    const resolved = await Promise.all(
      benchmarks.map((benchmark) => parseLeafUrl(benchmark.url, configDir, srcDir, resolveRef)),
    );
    const leaves = benchmarks.map((node, index) => ({ node, ...resolved[index] }));
    const variants = benchmarks.map((node, index) => ({
      name: node.name as string,
      refId: resolved[index].ref?.id ?? null,
    }));

    cases.push({
      name,
      configPath,
      config,
      leaves,
      variants,
      measurements: [...measurements],
    });
  }
  return cases;
}

/** The distinct pages referenced by a set of cases, as paths relative to `src`, sorted. */
export function pagesOf(cases: BenchmarkCase[]): string[] {
  return [...new Set(cases.flatMap((entry) => entry.leaves.map((leaf) => leaf.page)))].sort();
}
