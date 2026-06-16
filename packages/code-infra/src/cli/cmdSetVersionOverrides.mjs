#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import * as semver from 'semver';
import { $ } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { parseDocument, isMap } from 'yaml';
import {
  resolveVersion,
  findDependencyVersionFromSpec,
  readPackageJson,
  writePackageJson,
} from '../utils/pnpm.mjs';

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
 * Write the computed overrides into whichever manifest already defines
 * overrides — preferring pnpm-workspace.yaml, falling back to package.json
 * `pnpm.overrides`, defaulting to pnpm-workspace.yaml — and persist the result.
 * A missing pnpm-workspace.yaml is treated as empty, so a fresh file is created
 * with just the `overrides:` block. Rejects a `resolutions` field in
 * package.json because pnpm 11 silently ignores it.
 *
 * @param {string} workspaceDir - Workspace root directory
 * @param {Record<string, string>} overrides - Overrides computed from the CLI args
 * @returns {Promise<void>}
 */
export async function writeOverridesToWorkspace(workspaceDir, overrides) {
  const workspaceYamlPath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const yamlPromise = fs.readFile(workspaceYamlPath, { encoding: 'utf8' }).catch((error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      throw error;
    }
    return '';
  });
  const rootPackageJson = await readPackageJson(workspaceDir);
  const yamlSource = await yamlPromise;

  const { resolutions } = rootPackageJson;
  if (resolutions && Object.keys(resolutions).length > 0) {
    throw new Error(
      'Found a "resolutions" field in package.json. pnpm 11 ignores it silently. ' +
        'Move those entries into the "overrides:" key of pnpm-workspace.yaml.',
    );
  }

  // Parsed once, reused for both the read (does it have overrides?) and the write.
  const doc = parseDocument(yamlSource);
  const existing = doc.get('overrides');
  const workspaceHasOverrides = isMap(existing) && existing.items.length > 0;

  const pnpm = /** @type {{ overrides?: Record<string, string> } | undefined} */ (
    rootPackageJson.pnpm
  );
  const packageJsonOverrides = pnpm?.overrides;

  // Write where overrides already live; default to the workspace file.
  if (
    !workspaceHasOverrides &&
    packageJsonOverrides &&
    Object.keys(packageJsonOverrides).length > 0
  ) {
    await writePackageJson(workspaceDir, {
      ...rootPackageJson,
      pnpm: { ...pnpm, overrides: { ...packageJsonOverrides, ...overrides } },
    });
    return;
  }

  for (const [name, version] of Object.entries(overrides)) {
    doc.setIn(['overrides', name], version);
  }
  await fs.writeFile(workspaceYamlPath, doc.toString());
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
