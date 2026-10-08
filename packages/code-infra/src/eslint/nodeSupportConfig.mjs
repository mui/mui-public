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
 * Reports syntax, ECMAScript built-ins and Node.js APIs in package sources that the Node.js
 * versions allowed by the package's "engines.node" don't support. The ESM bundle is compiled for
 * the "stable" browserslist environment rather than for "engines.node", and nothing polyfills
 * built-ins, so all of them reach Node.js consumers as written.
 * Only packages that declare "engines.node", meaning they're intended to run in Node.js, are
 * checked.
 * @param {string} baseDirectory - The repository root. File patterns are resolved against it.
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
      basePath: baseDirectory,
      files: packageDirs.map((packageDir) => `${packageDir}/src/**/*${EXTENSION_TS}`),
      ignores: [`**/*${EXTENSION_TEST_FILE}`, `**/*.spec${EXTENSION_TS}`],
      plugins: { n: nPlugin },
      rules: {
        'n/no-unsupported-features/es-builtins': 'error',
        'n/no-unsupported-features/es-syntax': 'error',
        'n/no-unsupported-features/node-builtins': [
          'error',
          // Browser APIs that Node.js also exposes, behind an experimental flag. In packages that
          // combine Node.js tooling with browser code, these refer to the browser API.
          { ignores: ['localStorage', 'sessionStorage', 'Storage', 'navigator', 'Navigator'] },
        ],
      },
    },
  ]);
}
