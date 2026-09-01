import * as path from 'node:path';
import { access, readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseRefToken } from './refs.mjs';

/**
 * Case discovery: the `tachometer.json` files under a harness's `src/` are the source of truth for
 * which benchmark cases exist and which pages they reference.
 *
 * Both the runner and the vite plugin read them through here, so there is exactly one notion of
 * "what pages exist". The plugin passes no `resolveRef`, which keeps discovery free of git — a
 * plain `vite build` must not require a checkout with full history.
 */

/**
 * @typedef {import('./refs.mjs').ResolvedRef} ResolvedRef
 */

/**
 * @typedef {Object} Leaf
 * @property {{ url?: string }} node - The config node whose `url` this is; rewritten in place once builds exist
 * @property {string} page - Page path relative to `src`, e.g. `data-grid-init/index.html`
 * @property {ResolvedRef | null} ref - The resolved ref, or null when discovery ran without `resolveRef`
 * @property {string} suffix - Everything after the page path once `ref` was consumed: remaining query plus any fragment
 */

/**
 * @typedef {Object} CaseVariant
 * @property {string} name - The variant's name, as tachometer will report it
 * @property {string | null} refId - The ref this variant loads, or null when refs were not resolved
 */

/**
 * @typedef {Object} BenchmarkCase
 * @property {string} name - The case folder name
 * @property {string} configPath - Absolute path to its `tachometer.json`
 * @property {any} config - The parsed config, mutated in place as urls are rewritten
 * @property {Leaf[]} leaves - Every node that selects a page
 * @property {CaseVariant[]} variants - Declared variants in order; the first is every comparison's reference
 * @property {string[]} measurements - Measurement names, as tachometer will name them in its output
 */

/**
 * @typedef {Object} DiscoverCasesOptions
 * @property {string} harnessDir - The harness package directory; cases live under its `src/`
 * @property {string[]} [filters] - Only include cases whose folder name contains one of these substrings
 * @property {(token?: string) => ResolvedRef} [resolveRef] - Resolves a ref token. Omit to skip resolution entirely (no git)
 */

/** The file that marks a directory under `src/` as a benchmark case. */
const CONFIG_NAME = 'tachometer.json';

/**
 * True if `target` exists on disk.
 *
 * @param {string} target - Path to check
 * @returns {Promise<boolean>}
 */
async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The name tachometer gives a measurement: an explicit `name`, else the expression, else the entry
 * name.
 *
 * With more than one measurement on a page, tachometer appends ` [<name>]` to each benchmark's
 * name, and results have to be paired back by that name — pairing by position would compare
 * unrelated measurements.
 *
 * @param {any} measurement - A tachometer `measurement` entry
 * @returns {string}
 */
export function measurementNameOf(measurement) {
  if (typeof measurement === 'string') {
    return measurement;
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
 * Walks a benchmark's `expand` tree and collects its leaves — the nodes that actually select a page.
 *
 * `expand` is recursive and a child inherits its parent's `url` unless it overrides it, so the
 * effective url is threaded down and only nodes without further `expand` are leaves.
 *
 * @param {{ url?: string, name?: string, expand?: any[] }} node - The node to walk
 * @param {string | undefined} inheritedUrl - The effective url from the parent
 * @param {Array<{ node: { url?: string, name?: string }, url: string }>} out - Collected leaves
 * @returns {void}
 */
export function collectLeafNodes(node, inheritedUrl, out) {
  const url = node.url ?? inheritedUrl;
  if (Array.isArray(node.expand) && node.expand.length > 0) {
    for (const child of node.expand) {
      collectLeafNodes(child, url, out);
    }
    return;
  }
  if (url === undefined) {
    throw new Error('A benchmark variant has no "url" to resolve.');
  }
  out.push({ node, url });
}

/**
 * Resolves one leaf url into the source page it references, the ref it selects, and any leftovers.
 *
 * `ref` selects the build and is consumed here; everything else belongs to the page and has to
 * survive the rewrite, or a parameterised benchmark would silently run its defaults.
 *
 * @param {string} url - The leaf's url
 * @param {string} configDir - Directory the config lives in; relative urls resolve against it
 * @param {string} srcDir - The harness `src/` directory
 * @param {((token?: string) => ResolvedRef) | undefined} resolveRef - Ref resolver, or undefined to skip resolution
 * @returns {Promise<{ page: string, ref: ResolvedRef | null, suffix: string }>}
 */
async function parseLeafUrl(url, configDir, srcDir, resolveRef) {
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
 * Reads every `src/<case>/tachometer.json` (optionally filtered by name), expands the sugar for
 * cases that declare no variants of their own, and resolves each leaf's page and ref.
 *
 * A benchmark with no `expand` is the common regression case: it is expanded into `[current]` (the
 * working tree) versus `[baseline]`. A benchmark that declares its own `expand` owns its variant
 * axis — only the refs its leaves reference are resolved.
 *
 * @param {DiscoverCasesOptions} options - Where to look and how to resolve refs
 * @returns {Promise<BenchmarkCase[]>}
 */
export async function discoverCases(options) {
  const { harnessDir, filters = [], resolveRef } = options;
  const srcDir = path.join(harnessDir, 'src');

  const dirEntries = (await readdir(srcDir, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  const hasConfig = await Promise.all(
    dirEntries.map((entry) => pathExists(path.join(srcDir, entry.name, CONFIG_NAME))),
  );
  const caseNames = dirEntries
    .filter((_, index) => hasConfig[index])
    .map((entry) => entry.name)
    .filter((name) => filters.length === 0 || filters.some((filter) => name.includes(filter)))
    .sort();

  if (caseNames.length === 0) {
    throw new Error(
      filters.length > 0
        ? `No benchmark case under ${srcDir} matches ${filters.map((filter) => `"${filter}"`).join(', ')}.`
        : `No benchmark case with a ${CONFIG_NAME} found under ${srcDir}.`,
    );
  }

  const configs = await Promise.all(
    caseNames.map(async (name) => {
      const configPath = path.join(srcDir, name, CONFIG_NAME);
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      // `$schema` is for editors; tachometer rejects it in a config it is handed.
      delete config.$schema;
      return { name, configPath, config };
    }),
  );

  /** @type {BenchmarkCase[]} */
  const cases = [];
  for (const { name, configPath, config } of configs) {
    const configDir = path.dirname(configPath);

    /** @type {Array<{ node: { url?: string, name?: string }, url: string, benchmarkName: string }>} */
    const nodes = [];
    /** @type {Set<string>} */
    const measurements = new Set();
    for (const benchmark of config.benchmarks ?? []) {
      // `measurement` may be a single entry or a list; a page with several is exactly the case
      // whose results have to be paired by measurement name rather than by position.
      for (const measurement of [benchmark.measurement ?? 'callback'].flat()) {
        measurements.add(measurementNameOf(measurement));
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
        // The variants carry the url now; leaving the un-rewritten source url on the parent would
        // let tachometer inherit a page that was never built.
        delete benchmark.url;
      }

      /** @type {Array<{ node: { url?: string, name?: string }, url: string }>} */
      const benchmarkNodes = [];
      collectLeafNodes(benchmark, undefined, benchmarkNodes);
      // A leaf's own name is what tachometer reports; only an unexpanded benchmark falls back to
      // the benchmark's.
      for (const entry of benchmarkNodes) {
        nodes.push({ ...entry, benchmarkName: benchmark.name });
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const resolved = await Promise.all(
      nodes.map(({ url }) => parseLeafUrl(url, configDir, srcDir, resolveRef)),
    );
    const leaves = nodes.map(({ node }, index) => ({ node, ...resolved[index] }));
    const variants = nodes.map(({ node, benchmarkName }, index) => ({
      name: node.name ?? benchmarkName,
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

/**
 * The distinct pages referenced by a set of cases, as paths relative to `src`, sorted.
 *
 * @param {BenchmarkCase[]} cases - Discovered cases
 * @returns {string[]}
 */
export function pagesOf(cases) {
  return [...new Set(cases.flatMap((entry) => entry.leaves.map((leaf) => leaf.page)))].sort();
}
