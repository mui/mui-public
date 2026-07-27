#!/usr/bin/env node

import * as semver from 'semver';
import { $ } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { resolveVersion, writeOverridesToWorkspace } from '../utils/pnpm.mjs';

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
    // Published from one monorepo as a single release, so these must match.
    // scheduler is left out: it is versioned independently, and react-dom
    // already declares the version it needs.
    overrides.react = version;
    overrides['react-dom'] = version;
    overrides['react-is'] = version;

    // Reading the major only. A dist-tag is never repopulated across majors, so
    // this holds even when the install resolves to an earlier build.
    const reactMajor = semver.major(await resolveVersion(packageSpec));
    if (reactMajor === 17) {
      overrides['@testing-library/react'] = '^12.1.0';
    }
  } else if (packageName === '@mui/material') {
    // Special case for MUI - also override related packages
    overrides['@mui/material'] = version;
    overrides['@mui/system'] = version;
    overrides['@mui/icons-material'] = version;
    overrides['@mui/utils'] = version;
    overrides['@mui/material-nextjs'] = version;

    // @mui/lab is versioned separately, so it needs the tag for material's major.
    const [latest, resolved] = await Promise.all([
      resolveVersion('@mui/material@latest'),
      resolveVersion(`@mui/material@${version}`),
    ]);
    const muiMajor = semver.major(resolved);
    overrides['@mui/lab'] = muiMajor < semver.major(latest) ? `latest-v${muiMajor}` : 'latest';
  } else {
    // Pass the specifier through. Pinning leaves pnpm a single candidate, which
    // a minimumReleaseAge cooldown can reject outright.
    overrides[packageName] = version;
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
