import * as path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { pathExists } from '../utils/path.mjs';

/**
 * Which browser the benchmarks run on, and whether the driver can actually drive it.
 *
 * Both checks happen before anything is built: a driver that cannot open the browser fails the run
 * either way, and finding out now costs seconds instead of minutes of packing and installing.
 */

/**
 * Resolves the browser every case runs on: Playwright's pinned Chrome for Testing, rather than
 * whatever Chrome the machine has auto-updated to.
 *
 * The path is machine-specific, so callers inject it into each config instead of committing it.
 *
 * @param {string} harnessDir - The harness package directory, which `@playwright/test` resolves from
 * @returns {Promise<string>} Absolute path to the browser binary
 */
export async function resolveBrowserBinary(harnessDir) {
  const require = createRequire(path.join(harnessDir, 'package.json'));
  // `@playwright/test` is CommonJS, so `require` hands back its exports directly; a dynamic
  // `import()` would bury them under `default`.
  /** @type {typeof import('@playwright/test')} */
  let playwright;
  try {
    playwright = require('@playwright/test');
  } catch {
    throw new Error(
      `Could not resolve "@playwright/test" from ${harnessDir}. Add it as a devDependency — ` +
        `the benchmarks run on its pinned Chrome for Testing so results do not move when the ` +
        `machine's own Chrome updates.`,
    );
  }

  const binary = playwright.chromium.executablePath();
  if (!binary || !(await pathExists(binary))) {
    throw new Error(
      `Playwright's Chromium is not installed at "${binary}". Run \`pnpm exec playwright install chromium\`.`,
    );
  }
  return binary;
}

/**
 * Extracts the major version out of output like `Google Chrome for Testing 151.0.7922.34`.
 *
 * @param {string} versionOutput - A version string or `--version` output
 * @returns {number | undefined}
 */
export function majorVersionOf(versionOutput) {
  const match = /(\d+)\.\d+\.\d+/.exec(versionOutput);
  return match ? Number(match[1]) : undefined;
}

/**
 * Throws when the chromedriver tachometer will use cannot drive `binary`.
 *
 * A chromedriver only drives its own Chrome major. The driver is resolved the way tachometer
 * resolves it — from tachometer's own package root — so this checks the pair that will actually be
 * used rather than whatever else is installed.
 *
 * @param {string} harnessDir - The harness package directory, which tachometer resolves from
 * @param {string} binary - The browser binary that will be driven
 * @returns {void}
 */
export function assertDriverMatchesBrowser(harnessDir, binary) {
  const browserMajor = majorVersionOf(
    execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
  );

  /** @type {string | undefined} */
  let driverVersion;
  try {
    const fromHarness = createRequire(path.join(harnessDir, 'package.json'));
    const fromTachometer = createRequire(fromHarness.resolve('tachometer/package.json'));
    driverVersion = fromTachometer('chromedriver/package.json').version;
  } catch {
    console.warn(
      chalk.yellow(
        'Could not resolve chromedriver from tachometer; it will install the latest major itself, ' +
          'which fails against any browser not on that major yet. Pin a "chromedriver" ' +
          'devDependency to keep the two aligned.',
      ),
    );
    return;
  }

  const driverMajor = majorVersionOf(driverVersion ?? '');
  if (browserMajor === undefined || driverMajor === undefined) {
    console.warn(
      chalk.yellow('Could not read the browser or chromedriver version; skipping the check.'),
    );
    return;
  }
  if (browserMajor !== driverMajor) {
    throw new Error(
      `chromedriver ${driverVersion} cannot drive Chrome for Testing ${browserMajor}. ` +
        `Update the "chromedriver" devDependency to ${browserMajor}.x, or align ` +
        `"@playwright/test" with it — bump the two together.`,
    );
  }
}

/**
 * A benchmark's `browser` config. Only the two fields a run touches are named; everything else
 * tachometer accepts there (`name`, `headless`, `windowSize`, …) passes through untouched.
 *
 * @typedef {{ binary?: string, addArguments?: string[] } & Record<string, unknown>} BrowserConfig
 */

/** Chrome cannot enter its sandbox as root, and refusing to start is all it does about it. */
const NO_SANDBOX = '--no-sandbox';

/** Tachometer's default when a benchmark names no browser. */
const DEFAULT_BROWSER = 'chrome';

/** The suffix tachometer's browser shorthand uses to ask for a headless run. */
const HEADLESS_SUFFIX = '-headless';

/**
 * Normalises whatever a case put in `browser` into the object form, the way tachometer does.
 *
 * Tachometer accepts three things there: nothing at all, the string shorthand
 * `"<name>[-headless][@<remoteUrl>]"`, and an object. Only the object form can carry the binary and
 * the arguments a run has to add — and tachometer validates the whole config against its own schema
 * before reading any of it, where every browser variant requires `name` and forbids unknown keys.
 * So merging into the other two forms without converting first yields a config tachometer rejects
 * outright: `{ binary }` has no `name`, and spreading a string produces one key per character.
 *
 * `headless` and `windowSize` are left out on purpose. Tachometer's own `parseBrowserObject` fills
 * both from the defaults it would otherwise have applied, so naming the browser is all it takes to
 * reproduce what an absent `browser` did.
 *
 * @param {string | BrowserConfig | undefined} browser - Whatever the case declared, if anything
 * @returns {BrowserConfig}
 */
function asBrowserObject(browser) {
  if (browser === undefined) {
    return { name: DEFAULT_BROWSER };
  }
  if (typeof browser !== 'string') {
    // An object of its own may still leave out `name`, which the schema requires.
    return { name: DEFAULT_BROWSER, ...browser };
  }
  const at = browser.indexOf('@');
  const remoteUrl = at === -1 ? undefined : browser.slice(at + 1);
  const named = at === -1 ? browser : browser.slice(0, at);
  const headless = named.endsWith(HEADLESS_SUFFIX);
  const name = headless ? named.slice(0, -HEADLESS_SUFFIX.length) : named;
  return remoteUrl === undefined ? { name, headless } : { name, headless, remoteUrl };
}

/**
 * Merges what the run decides into a case's own `browser` config.
 *
 * Neither of these belongs in a committed `tachometer.json`. The binary is machine-specific. And
 * whether the sandbox has to come off depends on the user the run happens under: as root Chrome
 * exits during launch without explaining itself, leaving the driver to report nothing more than
 * `session not created: Chrome instance exited`. Containerised CI runs as root, so the flag goes
 * on there and nowhere else — a local run keeps the sandbox.
 *
 * @param {string | BrowserConfig | undefined} browser - The case's own browser config, if it has one
 * @param {string} binary - Binary to drive, unless the case pins its own
 * @param {boolean} asRoot - Whether the run is happening as root
 * @returns {BrowserConfig}
 */
export function withBrowserDefaults(browser, binary, asRoot) {
  const base = asBrowserObject(browser);
  const merged = { ...base, binary: base.binary ?? binary };
  const addArguments = merged.addArguments ?? [];
  if (asRoot && !addArguments.includes(NO_SANDBOX)) {
    merged.addArguments = [...addArguments, NO_SANDBOX];
  }
  return merged;
}

/**
 * Applies the run's browser defaults to a benchmark and to every `expand` node that declares a
 * browser of its own.
 *
 * A node only inherits its parent's browser until it names one: tachometer merges an expansion over
 * its parent with `Object.assign`, which replaces `browser` wholesale rather than merging into it.
 * So a variant that sets, say, its own `addArguments` would otherwise drop the binary this run
 * picked — and, in a containerised CI, the flag without which Chrome refuses to start as root.
 *
 * @param {any} node - A benchmark, or a node in its `expand` tree
 * @param {string} binary - Binary to drive, unless the node pins its own
 * @param {boolean} asRoot - Whether the run is happening as root
 * @param {boolean} [isRoot] - Whether this is the benchmark itself, which always gets a browser
 * @returns {void}
 */
export function applyBrowserDefaults(node, binary, asRoot, isRoot = true) {
  if (isRoot || node.browser !== undefined) {
    node.browser = withBrowserDefaults(node.browser, binary, asRoot);
  }
  for (const child of node.expand ?? []) {
    applyBrowserDefaults(child, binary, asRoot, false);
  }
}
