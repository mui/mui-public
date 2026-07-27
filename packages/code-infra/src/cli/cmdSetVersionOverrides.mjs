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
    // Special case for React - also override related packages. These ship from
    // one monorepo as a single release, so they have to land on the same build.
    // The specifier is passed through rather than pinned for the reason in the
    // generic branch below; pnpm keeps a repopulated dist-tag within the
    // original major, so they stay in step.
    //
    // scheduler is deliberately not overridden. It is versioned independently
    // (0.x), so a React specifier means nothing to it, and the version can only
    // come from react-dom — which is not resolved until install time, once the
    // cooldown has been applied. Reading it from `pnpm info react-dom@<spec>`
    // beforehand would take it from whichever build is newest, not the one
    // actually selected. Leaving it out lets react-dom's own declaration decide,
    // which cannot disagree; react-dom is the only package in material-ui and
    // mui-x that depends on scheduler at all, so there is nothing to reconcile.
    overrides.react = version;
    overrides['react-dom'] = version;
    overrides['react-is'] = version;

    // Resolving only to read the major. `pnpm info` ignores minimumReleaseAge,
    // and pnpm cannot repopulate a tag across majors, so this stays accurate
    // even when the install steps back to an earlier build.
    const reactMajor = semver.major(await resolveVersion(packageSpec));
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
    // Generic case for other packages: hand the specifier to pnpm as given
    // rather than pinning it to the version it resolves to right now.
    //
    // Under a `minimumReleaseAge` cooldown, pnpm picks the newest version
    // matching the specifier that has aged in. Pinning collapses that choice to
    // a single candidate, so a daily channel such as `typescript@next` — whose
    // tag always points at a build published hours ago — leaves pnpm with
    // nothing installable and fails with ERR_PNPM_NO_MATURE_MATCHING_VERSION.
    // The resolved version is recorded in the lockfile either way.
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
