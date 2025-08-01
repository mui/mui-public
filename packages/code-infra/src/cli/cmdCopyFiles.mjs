#!/usr/bin/env node
/* eslint-disable no-console */

import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import fs from 'node:fs/promises';
import path from 'path';

/**
 * @typedef {Object} Args
 * @property {boolean} [silent] Run in silent mode without logging
 * @property {boolean} [excludeDefaults] Exclude default files from the copy operation
 * @property {string} [buildDir] Directory to copy files to.
 */

/**
 * Check if a file exists.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileOrDirExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (err) {
    if (/** @type {{ code: string }} */ (err).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'copy-files',
  describe: 'Copy files from source to target paths within the build directory.',
  builder: (yargs) => {
    return yargs
      .option('silent', {
        type: 'boolean',
        default: false,
        description: "Don't log file names.",
      })
      .option('excludeDefaults', {
        type: 'boolean',
        default: false,
        description:
          'Exclude default files from the copy operation (includes readme, license, changelog).',
      })
      .option('buildDir', {
        type: 'string',
        default: 'build',
        description: 'Directory to copy files to.',
      })
      .positional('_', {
        type: 'string',
        describe: 'Files to copy, can be specified as `source:target` pairs or just `source`.',
        array: true,
        demandOption: true,
      });
  },
  handler: async (args) => {
    const { silent = false, excludeDefaults = false, buildDir = 'build' } = args;
    const cwd = process.cwd();
    const extraFiles = /** @type {string[]} */ (args._.slice(1));
    /**
     * @type {string[]}
     */
    const defaultFiles = [];
    const workspaceDir = await findWorkspaceDir(cwd);
    if (!workspaceDir) {
      throw new Error('Workspace directory not found');
    }
    const localOrRootFiles = [
      [path.join(cwd, 'README'), path.join(workspaceDir, 'README')],
      [path.join(cwd, 'LICENSE'), path.join(workspaceDir, 'LICENSE')],
      [path.join(cwd, 'CHANGELOG.md'), path.join(workspaceDir, 'CHANGELOG.md')],
    ];
    await Promise.all(
      localOrRootFiles.map(async (files) => {
        for (const file of files) {
          // eslint-disable-next-line no-await-in-loop
          if (await fileOrDirExists(file)) {
            defaultFiles.push(file);
            break;
          }
        }
      }),
    );

    const filesToCopy = excludeDefaults ? extraFiles : [...defaultFiles, ...extraFiles];
    if (!filesToCopy.length) {
      return;
    }
    await Promise.all(
      filesToCopy.map(async (file) => {
        const [sourcePath, targetPath] = path.isAbsolute(file)
          ? [file, undefined]
          : file.split(':');
        const resolvedSourcePath = path.resolve(cwd, sourcePath);
        const resolvedTargetPath = path.resolve(buildDir, targetPath ?? path.basename(file));
        if (await fileOrDirExists(resolvedSourcePath)) {
          await fs.cp(resolvedSourcePath, resolvedTargetPath, {
            recursive: true,
          });

          if (!silent) {
            console.log(`Copied ${sourcePath} to ${targetPath ?? path.basename(file)}`);
          }
        } else if (!silent) {
          console.warn(`Source does not exist: ${resolvedSourcePath}`);
        }
      }),
    );
  },
});
