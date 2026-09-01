import * as path from 'node:path';
import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import chalk from 'chalk';

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
