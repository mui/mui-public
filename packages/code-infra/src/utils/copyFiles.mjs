/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sep as posixSep } from 'node:path/posix';
import { mapConcurrently } from './build.mjs';

/**
 * @param {Object} param0
 * @param {string} param0.cwd - The current working directory.
 * @param {string[]} [param0.globs=[]] - Extra files to copy, can be specified as `source:target` pairs or just `source`.
 * @param {string} param0.buildDir - The build directory to copy to.
 * @param {boolean} [param0.verbose=false] - Whether to suppress output.
 * @returns {Promise<void>}
 */
export async function copyFiles({ cwd, globs = [], buildDir, verbose = false }) {
  /**
   * @type {(string|{targetPath: string; sourcePath: string})[]}
   */
  const defaultFiles = [];
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Workspace directory not found');
  }

  const localOrRootFiles = [
    [path.join(cwd, 'README.md'), path.join(workspaceDir, 'README.md')],
    [path.join(cwd, 'LICENSE'), path.join(workspaceDir, 'LICENSE')],
    [path.join(cwd, 'CHANGELOG.md'), path.join(workspaceDir, 'CHANGELOG.md')],
  ];
  await Promise.all(
    localOrRootFiles.map(async (filesToCopy) => {
      for (const file of filesToCopy) {
        if (
          // eslint-disable-next-line no-await-in-loop
          await fs.stat(file).then(
            () => true,
            () => false,
          )
        ) {
          defaultFiles.push(file);
          break;
        }
      }
    }),
  );

  if (globs.length) {
    const res = globs.map((globPattern) => {
      const [pattern, baseDir] = globPattern.split(':');
      return { pattern, baseDir };
    });
    /**
     * Avoids redundant globby calls for the same pattern.
     *
     * @type {Map<string, Promise<string[]>>}
     */
    const globToResMap = new Map();

    const result = await Promise.all(
      res.map(async ({ pattern, baseDir }) => {
        if (!globToResMap.has(pattern)) {
          const promise = globby(pattern, { cwd });
          globToResMap.set(pattern, promise);
        }
        const files = await globToResMap.get(pattern);
        return { files: files ?? [], baseDir };
      }),
    );
    globToResMap.clear();

    result.forEach(({ files, baseDir }) => {
      files.forEach((file) => {
        const sourcePath = path.resolve(cwd, file);
        // Use posix separator for the relative paths. So devs can only specify globs with `/` even on Windows.
        const pathSegments = file.split(posixSep);
        const relativePath =
          // Use index 2 (when required) since users can also specify paths like `./src/index.js`
          pathSegments.slice(pathSegments[0] === '.' ? 2 : 1).join(posixSep) || file;
        const targetPath = baseDir
          ? path.resolve(buildDir, baseDir, relativePath)
          : path.resolve(buildDir, relativePath);
        defaultFiles.push({ sourcePath, targetPath });
      });
    });
  }

  if (!defaultFiles.length) {
    if (verbose) {
      console.log('⓿ No files to copy.');
    }
  }
  await mapConcurrently(
    defaultFiles,
    async (file) => {
      if (typeof file === 'string') {
        const sourcePath = file;
        const fileName = path.basename(file);
        const targetPath = path.join(buildDir, fileName);
        await recursiveCopy({ source: sourcePath, target: targetPath, verbose });
      } else {
        await fs.mkdir(path.dirname(file.targetPath), { recursive: true });
        await recursiveCopy({ source: file.sourcePath, target: file.targetPath, verbose });
      }
    },
    20,
  );
  console.log(`📋 Copied ${defaultFiles.length} files.`);
}

/**
 * Recursively copies files and directories from a source path to a target path.
 *
 * @async
 * @param {Object} options - The options for copying files.
 * @param {string} options.source - The source path to copy from.
 * @param {string} options.target - The target path to copy to.
 * @param {boolean} [options.verbose=true] - If true, suppresses console output.
 * @returns {Promise<boolean>} Resolves when the copy operation is complete.
 * @throws {Error} Throws if an error occurs other than the source not existing.
 */
async function recursiveCopy({ source, target, verbose = true }) {
  try {
    await fs.cp(source, target, { recursive: true });
    if (verbose) {
      console.log(`Copied ${source} to ${target}`);
    }
    return true;
  } catch (err) {
    if (/** @type {{ code: string }} */ (err).code !== 'ENOENT') {
      throw err;
    }
    if (verbose) {
      console.warn(`Source does not exist: ${source}`);
    }
    throw err;
  }
}
