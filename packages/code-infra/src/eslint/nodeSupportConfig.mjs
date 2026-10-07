import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineConfig } from 'eslint/config';
import nPlugin from 'eslint-plugin-n';
import { EXTENSION_TEST_FILE, EXTENSION_TS } from './extensions.mjs';

/**
 * Finds the packages in the `packages*` directories of the repository that declare the Node.js
 * versions they support in "engines.node". Packages without it, like development tooling, run
 * on the repository's own Node.js version.
 * @param {string} baseDirectory
 * @returns {string[]} Package directories, relative to `baseDirectory`.
 */
function findPackageDirsWithEnginesNode(baseDirectory) {
  return fs
    .readdirSync(baseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('packages'))
    .flatMap((packagesDir) =>
      fs
        .readdirSync(path.join(baseDirectory, packagesDir.name), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.posix.join(packagesDir.name, entry.name)),
    )
    .filter((packageDir) => {
      const packageJsonPath = path.join(baseDirectory, packageDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        return false;
      }
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return typeof packageJson.engines?.node === 'string';
    });
}

/**
 * Reports built-ins and syntax in package sources that the Node.js versions allowed by the
 * package's "engines.node" don't support. The build only transpiles syntax for the "node"
 * browserslist target and doesn't polyfill built-ins, so they reach consumers as written.
 * Only packages that declare "engines.node" are checked.
 * @param {string} baseDirectory - The repository root.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createNodeSupportConfig(baseDirectory) {
  const packageDirs = findPackageDirsWithEnginesNode(baseDirectory);
  if (packageDirs.length === 0) {
    return [];
  }
  return defineConfig([
    {
      name: 'Node.js support of package sources',
      files: packageDirs.map((packageDir) => `${packageDir}/src/**/*${EXTENSION_TS}`),
      ignores: [`**/*${EXTENSION_TEST_FILE}`],
      plugins: { n: nPlugin },
      rules: {
        'n/no-unsupported-features/es-builtins': 'error',
        'n/no-unsupported-features/es-syntax': 'error',
      },
    },
  ]);
}
