import * as path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import * as semver from 'semver';
import type * as PlaywrightTest from '@playwright/test';
import { pathExists } from '../utils/path';

/**
 * Resolves the browser every case runs on: Playwright's pinned Chrome for Testing, rather than
 * whatever Chrome the machine has auto-updated to.
 *
 * The path is machine-specific, so callers inject it into each config instead of committing it.
 */
export async function resolveBrowserBinary(harnessDir: string): Promise<string> {
  let playwright: typeof PlaywrightTest;
  try {
    playwright = await import('@playwright/test');
  } catch {
    // An optional peer, so it installs cleanly when absent and only fails here.
    throw new Error(
      `"@playwright/test" is not installed. Add it as a devDependency of ${harnessDir}.`,
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
 * The major version in output like `Google Chrome for Testing 151.0.7922.34`, or undefined when
 * there is no version in it.
 *
 * The version is picked out of the surrounding words first, requiring at least three components so
 * a stray count is not read as one. Chrome's fourth component makes it invalid semver, so what is
 * left is coerced rather than parsed.
 */
export function majorVersionOf(versionOutput: string): number | undefined {
  const version = /\d+(?:\.\d+){2,}/.exec(versionOutput)?.[0];
  return version ? (semver.coerce(version)?.major ?? undefined) : undefined;
}

/**
 * Throws when the chromedriver tachometer will use cannot drive `binary`.
 */
export function assertDriverMatchesBrowser(harnessDir: string, binary: string): void {
  const browserMajor = majorVersionOf(
    execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
  );

  let driverVersion: string | undefined;
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
 */
export type BrowserConfig = {
  binary?: string;
  addArguments?: string[];
} & Record<string, unknown>;

/** Chrome cannot enter its sandbox as root, and refusing to start is all it does about it. */
const NO_SANDBOX = '--no-sandbox';

/** Tachometer's default when a benchmark names no browser. */
const DEFAULT_BROWSER = 'chrome';

/** The suffix tachometer's browser shorthand uses to ask for a headless run. */
const HEADLESS_SUFFIX = '-headless';

/**
 * Whatever a case put in `browser` as the object form tachometer's schema requires: `name` is
 * mandatory there and unknown keys are rejected, so the string shorthand
 * `"<name>[-headless][@<remoteUrl>]"` and an absent `browser` are both expanded here.
 */
function asBrowserObject(browser: string | BrowserConfig | undefined): BrowserConfig {
  if (browser === undefined) {
    return { name: DEFAULT_BROWSER };
  }
  if (typeof browser !== 'string') {
    // An object of its own may still leave out `name`, which the schema requires.
    return { name: DEFAULT_BROWSER, ...browser };
  }
  const at = browser.indexOf('@');
  const named = at === -1 ? browser : browser.slice(0, at);
  const headless = named.endsWith(HEADLESS_SUFFIX);
  const base: BrowserConfig = {
    name: headless ? named.slice(0, -HEADLESS_SUFFIX.length) : named,
    headless,
  };
  return at === -1 ? base : { ...base, remoteUrl: browser.slice(at + 1) };
}

/**
 * Merges what the run decides into a case's own `browser` config: the binary, which is
 * machine-specific, and the sandbox flag, which depends on the user the run happens under.
 */
export function withBrowserDefaults(
  browser: string | BrowserConfig | undefined,
  binary: string,
  asRoot: boolean,
): BrowserConfig {
  const base = asBrowserObject(browser);
  const merged: BrowserConfig = { ...base, binary: base.binary ?? binary };
  const addArguments = merged.addArguments ?? [];
  if (asRoot && !addArguments.includes(NO_SANDBOX)) {
    merged.addArguments = [...addArguments, NO_SANDBOX];
  }
  return merged;
}
