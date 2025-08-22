import * as babel from '@babel/core';
import * as nodePath from 'node:path';
import resolve from 'resolve/sync';

/**
 * Normalize a file path to POSIX in order for it to be platform-agnostic.
 */
function toPosixPath(importPath: string): string {
  return nodePath.normalize(importPath).split(nodePath.sep).join(nodePath.posix.sep);
}

/**
 * Converts a file path to a node import specifier.
 */
function pathToNodeImportSpecifier(importPath: string): string {
  const normalized = toPosixPath(importPath);
  return normalized.startsWith('/') || normalized.startsWith('.') ? normalized : `./${normalized}`;
}

export interface Options {
  outExtension?: string;
}

/**
 * Babel plugin for resolving import specifiers.
 */
export default function plugin(
  { types: t }: typeof babel,
  { outExtension }: Options,
): babel.PluginObj {
  const cache = new Map<string, string>();
  const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx'];
  const extensionsSet = new Set(extensions);

  function doResolve(
    importSource: babel.NodePath<babel.types.StringLiteral>,
    state: babel.PluginPass,
  ): void {
    const importedPath = importSource.node.value;

    const importExt = nodePath.extname(importedPath);
    // ignore if the import already has a desired extension or if it is a css import.
    if (extensionsSet.has(importExt) || importExt === '.css') {
      return;
    }

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
      TSImportType(path: babel.NodePath<babel.types.TSImportType>, state: babel.PluginPass) {
        const source = path.get('argument');
        doResolve(source, state);
      },
      CallExpression(path: babel.NodePath<babel.types.CallExpression>, state: babel.PluginPass) {
        const callee = path.get('callee');
        if (callee.isImport()) {
          const source = path.get('arguments')[0];
          if (source.isStringLiteral()) {
            doResolve(source, state);
          }
        }
      },
      ImportExpression(
        path: babel.NodePath<babel.types.ImportExpression>,
        state: babel.PluginPass,
      ) {
        const source = path.get('source');
        if (source.isStringLiteral()) {
          doResolve(source, state);
        }
      },
      ImportDeclaration(
        path: babel.NodePath<babel.types.ImportDeclaration>,
        state: babel.PluginPass,
      ) {
        const source = path.get('source');
        doResolve(source, state);
      },
      ExportNamedDeclaration(
        path: babel.NodePath<babel.types.ExportNamedDeclaration>,
        state: babel.PluginPass,
      ) {
        const source = path.get('source');
        if (source.isStringLiteral()) {
          doResolve(source, state);
        }
      },
      ExportAllDeclaration(
        path: babel.NodePath<babel.types.ExportAllDeclaration>,
        state: babel.PluginPass,
      ) {
        const source = path.get('source');
        doResolve(source, state);
      },
    },
  };
}
