#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as semver from 'semver';
import { $ } from 'execa';
import { resolveVersion, findDependencyVersionFromSpec } from '../utils/pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {string[]} [pkg] - Package version specifiers in format 'package@version'
 * @property {boolean} [engineStrict] - Whether to ignore engine field during installation
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

    const reactMajor = semver.major(overrides.react);
    if (reactMajor === 17) {
      overrides['@testing-library/react'] = await resolveVersion('@testing-library/react@^12.1.0');
    }
  } else if (packageName === '@mui/material') {
    // Special case for MUI - also override related packages
    overrides['@mui/material'] = await resolveVersion(`@mui/material@${version}`);
    overrides['@mui/system'] = await resolveVersion(`@mui/system@${version}`);
    overrides['@mui/icons-material'] = await resolveVersion(`@mui/icons-material@${version}`);
    overrides['@mui/utils'] = await resolveVersion(`@mui/utils@${version}`);
    overrides['@mui/material-nextjs'] = await resolveVersion(`@mui/material-nextjs@${version}`);

    const latest = await resolveVersion(`@mui/material@latest`);
    const latestMajor = semver.major(latest);
    const muiMajor = semver.major(overrides['@mui/material']);
    if (muiMajor < latestMajor) {
      overrides['@mui/lab'] = await resolveVersion(`@mui/lab@latest-v${muiMajor}`);
    } else {
      overrides['@mui/lab'] = await resolveVersion(`@mui/lab@latest`);
    }
  } else {
    // Generic case for other packages
    overrides[packageName] = await resolveVersion(packageSpec);
  }

  return overrides;
}

/**
 * Main function to set version overrides
 * @param {Args} args - Arguments containing package version specifiers
 * @returns {Promise<void>}
 */
async function handler(args) {
  if (!args.pkg || args.pkg.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No version overrides specified, skipping.');
    return;
  }

  const packageOverridePromises = args.pkg.map((packageSpec) =>
    processPackageOverride(packageSpec),
  );
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

  /** @type {(string)[]} */
  const restArgs = [];

  if (typeof args.engineStrict === 'boolean') {
    restArgs.push('--engine-strict', String(args.engineStrict));
  }

  await $({ stdio: 'inherit' })`pnpm dedupe ${restArgs}`;
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'set-version-overrides',
  describe: 'Set version overrides for packages throughout the repository',
  builder: (yargs) => {
    return yargs
      .option('pkg', {
        type: 'array',
        description:
          'Package version specifiers in format "package@version" (e.g., react@next, typescript@5.0.0)',
      })
      .option('engine-strict', {
        type: 'boolean',
        description: 'Whether to ignore engine field during installation',
      });
  },
  handler,
});
