// @ts-check
/// <reference path="./resolve.d.ts" />

const nodePath = require('path');
const resolve = require('resolve/sync');

/**
 * @typedef {import('@babel/core')} babel
 */

/**
 * Normalize a file path to POSIX in order for it to be platform-agnostic.
 * @param {string} importPath
 * @returns {string}
 */
function toPosixPath(importPath) {
  return nodePath.normalize(importPath).split(nodePath.sep).join(nodePath.posix.sep);
}

/**
 * Converts a file path to a node import specifier.
 * @param {string} importPath
 * @returns {string}
 */
function pathToNodeImportSpecifier(importPath) {
  const normalized = toPosixPath(importPath);
  return normalized.startsWith('/') || normalized.startsWith('.') ? normalized : `./${normalized}`;
}

/**
 * @typedef {{ outExtension?: string }} Options
 */

/**
 * @param {babel} file
 * @param {Options} options
 * @returns {babel.PluginObj}
 */
module.exports = function plugin({ types: t }, { outExtension }) {
  /** @type {Map<string, string>} */
  const cache = new Map();
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  const extensionsSet = new Set(extensions);

  /**
   *
   * @param {babel.NodePath<babel.types.StringLiteral>} importSource
   * @param {babel.PluginPass} state
   */
  function doResolve(importSource, state) {
    const importedPath = importSource.node.value;

    if (!importedPath.startsWith('.')) {
      // Only handle relative imports
      return;
    }

    if (!state.filename) {
      throw new Error('filename is not defined');
    }

    const importerPath = state.filename;
    const importerDir = nodePath.dirname(importerPath);
    // start from fully resolved import path
    const absoluteImportPath = nodePath.resolve(importerDir, importedPath);

    let resolvedPath = cache.get(absoluteImportPath);

    if (!resolvedPath) {
      // resolve to actual file
      resolvedPath = resolve(absoluteImportPath, { extensions });

      if (!resolvedPath) {
        throw new Error(`could not resolve "${importedPath}" from "${state.filename}"`);
      }

      const resolvedExtension = nodePath.extname(resolvedPath);
      if (outExtension && extensionsSet.has(resolvedExtension)) {
        // replace extension
        resolvedPath = nodePath.resolve(
          nodePath.dirname(resolvedPath),
          nodePath.basename(resolvedPath, resolvedExtension) + outExtension,
        );
      }

      cache.set(absoluteImportPath, resolvedPath);
    }

    const relativeResolvedPath = nodePath.relative(importerDir, resolvedPath);
    const importSpecifier = pathToNodeImportSpecifier(relativeResolvedPath);

    importSource.replaceWith(t.stringLiteral(importSpecifier));
  }

  return {
    visitor: {
      TSImportType(path, state) {
        const source = path.get('argument');
        doResolve(source, state);
      },
      CallExpression(path, state) {
        const callee = path.get('callee');
        if (callee.isImport()) {
          const source = path.get('arguments')[0];
          if (source.isStringLiteral()) {
            doResolve(source, state);
          }
        }
      },
      ImportExpression(path, state) {
        const source = path.get('source');
        if (source.isStringLiteral()) {
          doResolve(source, state);
        }
      },
      ImportDeclaration(path, state) {
        const source = path.get('source');
        doResolve(source, state);
      },
      ExportNamedDeclaration(path, state) {
        const source = path.get('source');
        if (source.isStringLiteral()) {
          doResolve(source, state);
        }
      },
      ExportAllDeclaration(path, state) {
        const source = path.get('source');
        doResolve(source, state);
      },
    },
  };
};
