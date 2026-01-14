import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';

/**
 * @param {string} cwd
 * @returns {Promise<string | undefined>}
 */
export async function findTsConfig(cwd) {
  const filesToCheck = ['tsconfig.build.json', 'tsconfig.json'];

  for (const fileName of filesToCheck) {
    const filePath = path.join(cwd, fileName);
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(filePath, fs.constants.F_OK);
      return filePath;
    } catch {
      // Continue to next
    }
  }
  return undefined;
}

/**
 * @param {string} cwd
 * @returns {Promise<string | undefined>}
 */
export async function findBabelConfigRoot(cwd) {
  // Check in current directory
  const localConfigs = [
    'babel.config.mjs',
    'babel.config.js',
    'babel.config.cjs',
    '.babelrc.js',
    '.babelrc.mjs',
  ];

  for (const config of localConfigs) {
    const configPath = path.join(cwd, config);
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(configPath, fs.constants.F_OK);
      return configPath;
    } catch {
      // Continue to next
    }
  }

  // Check in workspace root
  const workspaceRoot = await findWorkspaceDir(cwd);
  if (workspaceRoot && workspaceRoot !== cwd) {
    for (const config of localConfigs) {
      const configPath = path.join(workspaceRoot, config);
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.access(configPath, fs.constants.F_OK);
        return configPath;
      } catch {
        // Continue to next
      }
    }
  }

  return undefined;
}

/**
 * @param {{ name: string; version: string; license?: string }} packageInfo
 * @returns {string}
 */
export function generateBanner(packageInfo) {
  const license = packageInfo.license ?? 'proprietary';
  return `/**
 * ${packageInfo.name} v${packageInfo.version}
 *
 * @license ${license}
 * This source code is licensed under the ${license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
`;
}
