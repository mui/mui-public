#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {Object} Args
 * @property {string} [react] - React version specifier
 * @property {string} [typescript] - TypeScript version specifier
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as semver from 'semver';
import { $ } from 'execa';
import { resolveVersionSpec, findDependencyVersion } from './pnpm.mjs';

/**
 * Main function to set version overrides
 * @param {Args} versions - Version configuration
 * @returns {Promise<void>}
 */
async function handler(versions) {
  const overrides = {};

  if (versions.react && versions.react !== 'stable') {
    console.log(`Resolving overrides for React version: ${versions.react}`);
    overrides.react = await resolveVersionSpec('react', versions.react);
    overrides['react-dom'] = await resolveVersionSpec('react-dom', versions.react);
    overrides['react-is'] = await resolveVersionSpec('react-is', versions.react);
    overrides.scheduler = await findDependencyVersion('react-dom', versions.react, 'scheduler');

    const reactMajor = semver.major(overrides.react);
    if (reactMajor === 17) {
      overrides['@testing-library/react'] = await resolveVersionSpec(
        '@testing-library/react',
        '^12.1.0',
      );
    }
  }

  if (versions.typescript && versions.typescript !== 'stable') {
    console.log(`Resolving overrides for TypeScript version: ${versions.typescript}`);
    overrides.typescript = await resolveVersionSpec('typescript', versions.typescript);
  }

  if (Object.keys(overrides).length <= 0) {
    console.log('No version overrides specified, skipping.');
    return;
  }

  console.log(`Using overrides: ${JSON.stringify(overrides, null, 2)}`);

  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, { encoding: 'utf8' }));
  packageJson.resolutions ??= {};
  Object.assign(packageJson.resolutions, overrides);
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}${os.EOL}`);

  await $({ stdio: 'inherit' })`pnpm dedupe`;
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'set-version-overrides',
  describe: 'Set version overrides for React and TypeScript throughout the repository',
  builder: (yargs) => {
    return yargs
      .option('react', {
        type: 'string',
        description: 'React version specifier (dist-tag, range, or exact version)',
        default: process.env.REACT_VERSION,
      })
      .option('typescript', {
        type: 'string',
        description: 'TypeScript version specifier (dist-tag, range, or exact version)',
        default: process.env.TYPESCRIPT_VERSION,
      });
  },
  handler,
});
