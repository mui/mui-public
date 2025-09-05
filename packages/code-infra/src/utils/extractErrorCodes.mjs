/* eslint-disable no-console */
import { types as babelTypes, parseAsync, traverse } from '@babel/core';
import babelSyntaxJsx from '@babel/plugin-syntax-jsx';
import babelSyntaxTypescript from '@babel/plugin-syntax-typescript';
import { findMessageNode } from '@mui/internal-babel-plugin-minify-errors';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getWorkspacePackages } from '../cli/pnpm.mjs';
import { BASE_IGNORES, wrapInWorker } from './build.mjs';

/**
 * @typedef {Object} Args
 * @property {string} errorCodesPath - The output path to write the extracted error codes.
 * @property {string[]} [skip=[]] - List of package names to skip. By default, all workspace packages are considered.
 * @property {import('@mui/internal-babel-plugin-minify-errors').Options['detection']} [detection='opt-in'] - The detection strategy to use when extracting error codes.
 */

/**
 * Extracts error codes from all files in a directory.
 * @param {import('../cli/pnpm.mjs').PublicPackage} pkg
 * @param {Set<string>} errors
 * @param {import('@mui/internal-babel-plugin-minify-errors').Options['detection']} [detection='opt-in']
 */
async function extractErrorCodesForPackage(pkg, errors, detection = 'opt-in') {
  const srcPath = path.join(pkg.path, 'src');
  const srcPathExists = await fs
    .stat(srcPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  // Implementation to extract error codes from all files in the directory
  const cwd = srcPathExists ? srcPath : pkg.path;
  const files = await globby('**/*.{js,ts,jsx,tsx,cjs,mjs,cts}', {
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'scripts',
      '**/__{tests,fixtures,mock,mocks}__/**',
      ...BASE_IGNORES,
    ],
    cwd,
  });
  const workerCount = Math.min(40, files.length);
  console.log(`🔍 ${pkg.name}: Processing ${files.length} file${files.length > 1 ? 's' : ''}...`);
  await wrapInWorker(
    async (file) => {
      const fullPath = path.join(cwd, file);
      const code = await fs.readFile(fullPath, 'utf8');
      const ast = await parseAsync(code, {
        filename: fullPath,
        sourceType: 'module',
        plugins: [[babelSyntaxTypescript, { isTSX: true }], [babelSyntaxJsx]],
        configFile: false,
        babelrc: false,
        browserslistConfigFile: false,
        code: false,
      });
      if (!ast) {
        throw new Error(`Failed to parse ${fullPath}`);
      }
      traverse(ast, {
        NewExpression(newExpressionPath) {
          const { message } =
            findMessageNode(babelTypes, newExpressionPath, {
              detection,
              missingError: 'annotate',
            }) ?? {};
          if (message) {
            errors.add(message.message);
          }
        },
      });
    },
    { defaultConcurrency: workerCount, items: files },
  );
}

/**
 * Extracts error codes from all workspace packages.
 * @param {Args} args
 */
export default async function extractErrorCodes(args) {
  /**
   * @type {Set<string>}
   */
  const errors = new Set();
  const basePackages = await getWorkspacePackages({
    publicOnly: true,
  });
  const { skip: skipPackages = [], errorCodesPath, detection = 'opt-in' } = args;
  const packages = basePackages.filter(
    (pkg) =>
      // Ignore obvious packages that do not have user-facing errors
      !pkg.name.startsWith('@mui/internal-') &&
      !pkg.name.startsWith('@mui-internal/') &&
      !skipPackages.includes(pkg.name),
  );
  await Promise.all(packages.map((pkg) => extractErrorCodesForPackage(pkg, errors, detection)));
  const errorCodeFilePath = path.resolve(errorCodesPath);
  const fileExists = await fs
    .stat(errorCodeFilePath)
    .then((stat) => stat.isFile())
    .catch((ex) => {
      if (ex.code === 'ENOENT') {
        return false;
      }
      return new Error(ex.message);
    });

  if (fileExists instanceof Error) {
    throw fileExists;
  }
  /**
   * @type {Record<string, string>}
   */
  const existingErrorCodes =
    fileExists === true ? JSON.parse(await fs.readFile(errorCodeFilePath, 'utf-8')) : {};
  const inverseLookupCode = new Map(
    Object.entries(existingErrorCodes).map(([key, value]) => [value, Number(key)]),
  );
  const originalErrorCount = inverseLookupCode.size;
  Array.from(errors).forEach((error) => {
    if (!inverseLookupCode.has(error)) {
      inverseLookupCode.set(error, inverseLookupCode.size + 1);
    }
  });
  const finalErrorCodes = Array.from(inverseLookupCode.entries()).reduce((acc, [message, code]) => {
    acc[code] = message;
    return acc;
  }, /** @type {Record<string, string>} */ ({}));
  if (!fileExists) {
    await fs.mkdir(path.dirname(errorCodeFilePath), { recursive: true });
  }
  await fs.writeFile(errorCodeFilePath, `${JSON.stringify(finalErrorCodes, null, 2)}\n`);
  const newErrorCount = inverseLookupCode.size - originalErrorCount;
  if (newErrorCount === 0) {
    console.log(`✅ No new error codes found.`);
  } else {
    console.log(
      `📝 Wrote ${newErrorCount} new error code${newErrorCount > 1 ? 's' : ''} to "${errorCodesPath}"`,
    );
  }
}
