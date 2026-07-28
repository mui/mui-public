#!/usr/bin/env node

import * as semver from 'semver';
import { $ } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { parseWantedDependency } from '@pnpm/parse-wanted-dependency';
import {
  getMinimumReleaseAgePolicy,
  resolveVersion,
  findDependencyVersionFromSpec,
  writeOverridesToWorkspace,
} from '../utils/pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {string[]} [pkg] - Package version specifiers in format 'package@version'
 */

/**
 * Process a single package override
 * @param {string} packageSpec - Package specifier in format "package@version"
 * @param {import('@pnpm/config.version-policy').PublishedByPolicy} policy - Registry cooldown to resolve within
 * @returns {Promise<Record<string, string>>} Overrides object for this package
 */
async function processPackageOverride(packageSpec, policy) {
  /** @type {Record<string, string>} */
  const overrides = {};

  const { alias: packageName, bareSpecifier: version } = parseWantedDependency(packageSpec);
  if (!packageName || version === undefined) {
    throw new Error(`Invalid package specifier: ${packageSpec}`);
  }

  // An empty version is distinct from a missing one: CI interpolates a matrix
  // value into `--pkg pkg@<version>`, and the leg that leaves it unset must skip
  // the override rather than fail the job.
  if (!version || version === 'stable') {
    return overrides;
  }

  // eslint-disable-next-line no-console
  console.log(`Resolving overrides for ${packageName} version: ${version}`);

  if (packageName === 'react') {
    // Special case for React - also override related packages
    overrides.react = await resolveVersion(packageSpec, policy);
    overrides['react-dom'] = await resolveVersion(`react-dom@${version}`, policy);
    overrides['react-is'] = await resolveVersion(`react-is@${version}`, policy);
    overrides.scheduler = await findDependencyVersionFromSpec(
      `react-dom@${overrides['react-dom']}`,
      'scheduler',
      policy,
    );

    const reactMajor = semver.major(overrides.react);
    if (reactMajor === 17) {
      overrides['@testing-library/react'] = await resolveVersion(
        '@testing-library/react@^12.1.0',
        policy,
      );
    }
  } else if (packageName === '@mui/material') {
    // Special case for MUI - also override related packages
    overrides['@mui/material'] = await resolveVersion(`@mui/material@${version}`, policy);
    overrides['@mui/system'] = await resolveVersion(`@mui/system@${version}`, policy);
    overrides['@mui/icons-material'] = await resolveVersion(
      `@mui/icons-material@${version}`,
      policy,
    );
    overrides['@mui/utils'] = await resolveVersion(`@mui/utils@${version}`, policy);
    overrides['@mui/material-nextjs'] = await resolveVersion(
      `@mui/material-nextjs@${version}`,
      policy,
    );

    const latest = await resolveVersion(`@mui/material@latest`, policy);
    const latestMajor = semver.major(latest);
    const muiMajor = semver.major(overrides['@mui/material']);
    const labTag = muiMajor < latestMajor ? `latest-v${muiMajor}` : 'latest';
    overrides['@mui/lab'] = await resolveVersion(`@mui/lab@${labTag}`, policy);
  } else {
    // Generic case for other packages
    overrides[packageName] = await resolveVersion(packageSpec, policy);
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

  // Read once and thread through: every override must land on a version that
  // clears the same cooldown the following `pnpm dedupe` enforces.
  const policy = await getMinimumReleaseAgePolicy();

  const packageOverridePromises = args.pkg.map((packageSpec) =>
    processPackageOverride(packageSpec, policy),
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

  const workspaceDir = (await findWorkspaceDir(process.cwd())) ?? process.cwd();
  await writeOverridesToWorkspace(workspaceDir, overrides);

  await $({ stdio: 'inherit' })`pnpm dedupe`;
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'set-version-overrides',
  describe: 'Set version overrides for packages throughout the repository',
  builder: (yargs) => {
    return yargs.option('pkg', {
      type: 'array',
      description:
        'Package version specifiers in format "package@version" (e.g., react@next, typescript@5.0.0)',
    });
  },
  handler,
});
