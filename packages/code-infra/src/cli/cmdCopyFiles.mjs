import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { globby } from 'globby';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mapConcurrently } from '../utils/build.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [silent] Run in silent mode without logging
 * @property {boolean} [excludeDefaults] Exclude default files from the copy operation
 * @property {string[]} [glob] Glob patterns to copy
 * @property {string[]} [files] Extra files to copy
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

/**
 * Recursively copies files and directories from a source path to a target path.
 *
 * @async
 * @param {Object} options - The options for copying files.
 * @param {string} options.source - The source path to copy from.
 * @param {string} options.target - The target path to copy to.
 * @param {boolean} [options.silent=false] - If true, suppresses console output.
 * @returns {Promise<boolean>} Resolves when the copy operation is complete.
 * @throws {Error} Throws if an error occurs other than the source not existing.
 */
async function recursiveCopy({ source, target, silent = false }) {
  try {
    await fs.cp(source, target, { recursive: true });
    if (!silent) {
      // eslint-disable-next-line no-console
      console.log(`Copied ${source} to ${target}`);
    }
    return true;
  } catch (err) {
    if (/** @type {{ code: string }} */ (err).code !== 'ENOENT') {
      throw err;
    }
    if (!silent) {
      console.warn(`Source does not exist: ${source}`);
    }
    throw err;
  }
}

/**
 * Process glob patterns and copy matching files.
 * @param {Object} param0
 * @param {boolean} [param0.silent=true] - Whether to suppress output.
 * @param {string[]} param0.globs - The glob patterns to process.
 * @param {string} param0.cwd - The current working directory.
 * @param {string} param0.buildDir - The build directory.
 * @returns {Promise<number>}
 */
async function processGlobs({ globs, cwd, silent = true, buildDir }) {
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

  const filesToProcess = result.flatMap(({ files, baseDir }) => {
    return files.map((file) => {
      const sourcePath = path.resolve(cwd, file);
      const pathSegments = file.split(path.sep);
      const relativePath = pathSegments.slice(1).join(path.sep);
      const targetPath = baseDir
        ? path.resolve(buildDir, baseDir, relativePath)
        : path.resolve(buildDir, relativePath);
      const targetDir = path.dirname(targetPath);
      return { targetDir, targetPath, sourcePath };
    });
  });

  await mapConcurrently(
    filesToProcess,
    async (file) => {
      await recursiveCopy({ source: file.sourcePath, target: file.targetPath, silent });
    },
    50,
  );
  return filesToProcess.length;
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'copy-files [files...]',
  describe: 'Copy files from source to target paths within the build directory.',
  builder: (yargs) => {
    return yargs
      .option('silent', {
        type: 'boolean',
        default: true,
        description: "Don't log file names.",
      })
      .option('excludeDefaults', {
        type: 'boolean',
        default: false,
        description:
          'Exclude default files from the copy operation (includes readme, license, changelog).',
      })
      .option('glob', {
        type: 'string',
        array: true,
        description: 'Glob pattern to match files.',
      })
      .positional('files', {
        type: 'string',
        describe: 'Files to copy, can be specified as `source:target` pairs or just `source`.',
        array: true,
        default: [],
      });
  },
  handler: async (args) => {
    const { silent = false, excludeDefaults = false, glob: globs = [] } = args;
    const cwd = process.cwd();
    const pkgJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
    /** @type {string} */
    const buildDir = pkgJson.publishConfig?.directory || 'build';
    const extraFiles = args.files ?? [];
    /** @type {string[]} */
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

    const filesToCopy = [...(excludeDefaults ? [] : defaultFiles), ...extraFiles];
    let result = filesToCopy.length;

    if (filesToCopy.length) {
      await Promise.all(
        filesToCopy.map(async (file) => {
          const [sourcePath, targetPath] = path.isAbsolute(file)
            ? [file, undefined]
            : file.split(':');
          const resolvedSourcePath = path.resolve(cwd, sourcePath);
          const resolvedTargetPath = path.resolve(buildDir, targetPath ?? path.basename(file));
          return recursiveCopy({
            source: resolvedSourcePath,
            target: resolvedTargetPath,
            silent,
          });
        }),
      );
    }

    if (globs.length) {
      result += await processGlobs({
        globs,
        cwd,
        buildDir,
        silent,
      });
    }
    // eslint-disable-next-line no-console
    console.log(`Copied ${result} files.`);
  },
});
