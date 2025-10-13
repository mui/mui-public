#!/usr/bin/env node

// This script will be run before installing dependencies in CI. Therefore it's not
// possible to use any external dependencies here.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import childProcess from 'node:child_process';

const exec = promisify(childProcess.exec);

/**
 * Resolve a package@version specifier to an exact version
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @returns {Promise<string>} Exact version string
 */
export async function resolveVersion(packageSpec) {
  const result = await exec(`pnpm info ${packageSpec} version --json`);
  const versions = JSON.parse(result.stdout);
  return typeof versions === 'string' ? versions : versions[versions.length - 1];
}

/**
 * Find the version of a dependency for a specific package@version
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @param {string} dependency - Dependency name to look up
 * @returns {Promise<string>} Exact version string of the dependency
 */
export async function findDependencyVersionFromSpec(packageSpec, dependency) {
  const result = await exec(`pnpm info ${packageSpec} dependencies.${dependency}`);
  const spec = result.stdout.trim();
  return resolveVersion(`${dependency}@${spec}`);
}

/**
 * @typedef {Object} Args
 * @property {string[]} [pkg] - Package version specifiers in format 'package@version'
 */

/**
 * Process a single package override
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @returns {Promise<Record<string, string>>} Overrides object for this package
 */
async function processPackageOverride(packageSpec) {
  /** @type {Record<string, string>} */
  const overrides = {};

  // Extract package name to check for special cases
  const lastAtIndex = packageSpec.lastIndexOf('@');
  if (lastAtIndex === -1) {
    throw new Error(`Invalid package specifier: ${packageSpec}`);
  }

  const packageName = packageSpec.slice(0, lastAtIndex);
  const version = packageSpec.slice(lastAtIndex + 1);

  if (!packageName || !version || version === 'stable') {
    return overrides;
  }

  // eslint-disable-next-line no-console
  console.log(`Resolving overrides for ${packageName} version: ${version}`);

  if (packageName === 'react') {
    // Special case for React - also override related packages
    overrides.react = await resolveVersion(packageSpec);
    overrides['react-dom'] = await resolveVersion(`react-dom@${version}`);
    overrides['react-is'] = await resolveVersion(`react-is@${version}`);
    overrides.scheduler = await findDependencyVersionFromSpec(
      `react-dom@${overrides['react-dom']}`,
      'scheduler',
    );

    if (overrides.react.split('.')[0] === '17') {
      overrides['@testing-library/react'] = await resolveVersion('@testing-library/react@^12.1.0');
    }
  } else {
    // Generic case for other packages
    overrides[packageName] = await resolveVersion(packageSpec);
  }

  return overrides;
}

/**
 * Main function to set version overrides
 * @returns {Promise<void>}
 */
async function main() {
  const pkgs = process.argv.slice(2);

  if (pkgs.length <= 0) {
    // eslint-disable-next-line no-console
    console.log('No version overrides specified, skipping.');
    return;
  }

  const packageOverridePromises = pkgs.map((packageSpec) => processPackageOverride(packageSpec));
  const packageOverrideResults = await Promise.all(packageOverridePromises);

  const overrides = Object.assign({}, ...packageOverrideResults);

  if (Object.keys(overrides).length <= 0) {
    // eslint-disable-next-line no-console
    console.log('No version overrides specified, skipping.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Using overrides: ${JSON.stringify(overrides, null, 2)}`);

  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, { encoding: 'utf8' }));
  packageJson.resolutions ??= {};
  Object.assign(packageJson.resolutions, overrides);
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}${os.EOL}`);

  await new Promise((resolve, reject) => {
    const child = childProcess.spawn('pnpm', ['dedupe'], {
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pnpm dedupe process exited with code ${code}`));
        return;
      }
      resolve(null);
    });
  });
}

main();
