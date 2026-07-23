import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseAst } from 'rolldown/parseAst';

/**
 * Only string constants whose value looks like a data attribute are inlined. These are safe
 * to duplicate at every call site (they are immutable primitives) and inlining them lets the
 * module that declared them tree-shake away in consumer bundles.
 */
const DATA_ATTRIBUTE = /^data-/;

/** Extensions probed when resolving an extensionless relative import to a source file. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * @param {string} file
 * @returns {'ts' | 'tsx' | 'js' | 'jsx'}
 */
function langForFile(file) {
  if (file.endsWith('.tsx')) {
    return 'tsx';
  }
  if (file.endsWith('.jsx')) {
    return 'jsx';
  }
  if (/\.[cm]?ts$/.test(file)) {
    return 'ts';
  }
  return 'jsx';
}

/**
 * Extracts top-level `export const NAME = 'data-...'` string constants from a single module.
 *
 * @param {string} code
 * @param {string} file - Used only to pick the parser language.
 * @returns {Map<string, string>} Exported name to its literal value.
 */
function extractDataConstants(code, file) {
  /** @type {Map<string, string>} */
  const constants = new Map();
  if (!code.includes('data-')) {
    return constants;
  }
  const ast = parseAst(code, { lang: langForFile(file) });
  for (const node of ast.body) {
    if (
      node.type !== 'ExportNamedDeclaration' ||
      node.declaration?.type !== 'VariableDeclaration'
    ) {
      continue;
    }
    if (node.declaration.kind !== 'const') {
      continue;
    }
    for (const declarator of node.declaration.declarations) {
      if (
        declarator.id.type === 'Identifier' &&
        declarator.init?.type === 'Literal' &&
        typeof declarator.init.value === 'string' &&
        DATA_ATTRIBUTE.test(declarator.init.value)
      ) {
        constants.set(declarator.id.name, declarator.init.value);
      }
    }
  }
  return constants;
}

/**
 * Scans the source tree for the exported `data-*` string constants that can be inlined.
 * Runs before the bundle so every module's constants are known regardless of build order.
 *
 * @param {string[]} files - Source paths relative to `sourceDir`.
 * @param {string} sourceDir - Absolute path to the package `src` directory.
 * @returns {Promise<Map<string, Map<string, string>>>} Absolute module path to its constants.
 */
export async function scanDataConstants(files, sourceDir) {
  /** @type {Map<string, Map<string, string>>} */
  const constantsByModule = new Map();
  await Promise.all(
    files.map(async (file) => {
      const absolute = path.join(sourceDir, file);
      const code = await fs.readFile(absolute, 'utf8');
      const constants = extractDataConstants(code, file);
      if (constants.size > 0) {
        constantsByModule.set(absolute, constants);
      }
    }),
  );
  return constantsByModule;
}

/**
 * Resolves a relative import specifier to an absolute path that exists in `constantsByModule`,
 * probing the same extensions and index files Node's ESM resolver would. Returns undefined
 * when the target has no inlinable constants, so callers simply skip it.
 *
 * @param {string} importerAbsolute
 * @param {string} specifier
 * @param {Map<string, Map<string, string>>} constantsByModule
 * @returns {string | undefined}
 */
function resolveToModuleWithConstants(importerAbsolute, specifier, constantsByModule) {
  const base = path.resolve(path.dirname(importerAbsolute), specifier);
  const candidates = [base, ...RESOLVE_EXTENSIONS.map((extension) => base + extension)];
  for (const extension of RESOLVE_EXTENSIONS) {
    candidates.push(path.join(base, `index${extension}`));
  }
  return candidates.find((candidate) => constantsByModule.has(candidate));
}

/**
 * A Babel plugin that inlines cross-module `data-*` string constants at their call sites.
 *
 * Base UI declares data attributes as `export const checked = 'data-checked'` and reads them
 * as `import * as FooDataAttributes from './metadata'` / `FooDataAttributes.checked`, so the
 * value is authored once but referenced everywhere. Rolldown keeps the import under
 * `preserveModules` (it does not inline cross-module constants), which leaves the referencing
 * module tied to the constants module and defeats consumer tree-shaking. Replacing each
 * reference with its literal frees the reference so rolldown can drop the dead import.
 *
 * Runs during the per-file Babel transform, so Babel's scope resolution decides which
 * references are the imported binding -- a shadowing `function f(checked) {}` is left alone.
 * Both `import * as ns` member access (`ns.checked`, `ns['checked']`) and named imports
 * (`import { checked }`) are handled. A reference that cannot be inlined (an unknown member,
 * the namespace used as a value) keeps its import untouched.
 *
 * A missed constant is only a smaller optimization, never a miscompile, so unresolved or
 * unrecognized cases are skipped rather than treated as errors.
 *
 * @param {Object} options
 * @param {Map<string, Map<string, string>>} options.constantsByModule
 * @param {{ inlined: number }} [options.stats] - Mutated with the number of inlined references.
 * @returns {(api: typeof import('@babel/core')) => import('@babel/core').PluginObj}
 */
export function createInlineDataConstantsPlugin({ constantsByModule, stats }) {
  return function inlineDataConstants({ types: t }) {
    return {
      name: 'inline-data-constants',
      visitor: {
        /**
         * @param {import('@babel/core').NodePath<import('@babel/core').types.ImportDeclaration>} importPath
         * @param {import('@babel/core').PluginPass} state
         */
        ImportDeclaration(importPath, state) {
          const importerAbsolute = state.filename;
          const specifier = importPath.node.source.value;
          if (!importerAbsolute || !specifier.startsWith('.')) {
            return;
          }
          const moduleId = resolveToModuleWithConstants(
            importerAbsolute,
            specifier,
            constantsByModule,
          );
          const constants = moduleId && constantsByModule.get(moduleId);
          if (!constants) {
            return;
          }

          for (const specifierNode of [...importPath.node.specifiers]) {
            const binding = importPath.scope.getBinding(specifierNode.local.name);
            if (!binding) {
              continue;
            }

            if (specifierNode.type === 'ImportNamespaceSpecifier') {
              let hasRemainingUse = false;
              for (const reference of binding.referencePaths) {
                const member = reference.parent;
                const isNamespaceMember =
                  t.isMemberExpression(member) && member.object === reference.node;
                const name = isNamespaceMember ? memberName(t, member) : undefined;
                const literal = name !== undefined ? constants.get(name) : undefined;
                if (literal !== undefined && reference.parentPath) {
                  reference.parentPath.replaceWith(t.stringLiteral(literal));
                  if (stats) {
                    stats.inlined += 1;
                  }
                } else {
                  hasRemainingUse = true;
                }
              }
              if (!hasRemainingUse) {
                removeSpecifier(importPath, specifierNode);
              }
            } else if (specifierNode.type === 'ImportSpecifier') {
              const importedName =
                specifierNode.imported.type === 'Identifier'
                  ? specifierNode.imported.name
                  : specifierNode.imported.value;
              const literal = constants.get(importedName);
              if (literal === undefined) {
                continue;
              }
              for (const reference of binding.referencePaths) {
                reference.replaceWith(t.stringLiteral(literal));
                if (stats) {
                  stats.inlined += 1;
                }
              }
              removeSpecifier(importPath, specifierNode);
            }
          }

          if (importPath.node.specifiers.length === 0) {
            importPath.remove();
          }
        },
      },
    };
  };
}

/**
 * @param {typeof import('@babel/core').types} t
 * @param {import('@babel/core').types.MemberExpression} member
 * @returns {string | undefined}
 */
function memberName(t, member) {
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  if (member.computed && t.isStringLiteral(member.property)) {
    return member.property.value;
  }
  return undefined;
}

/**
 * @param {import('@babel/core').NodePath<import('@babel/core').types.ImportDeclaration>} importPath
 * @param {import('@babel/core').types.ImportDeclaration['specifiers'][number]} specifierNode
 * @returns {void}
 */
function removeSpecifier(importPath, specifierNode) {
  importPath.node.specifiers = importPath.node.specifiers.filter(
    (candidate) => candidate !== specifierNode,
  );
}
