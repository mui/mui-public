import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseAst } from 'rolldown/parseAst';

/**
 * Matches the styling-contract strings worth inlining: data attributes (`data-open`) and CSS
 * custom properties (`--popup-width`). Both are immutable primitives, so duplicating them at
 * every call site is safe, and doing so lets the module that declared them tree-shake away in
 * consumer bundles.
 *
 * A prefix on its own is not enough -- a bare `--` is the end-of-options marker rather than a
 * custom property -- so at least one more character is required.
 */
const INLINABLE_VALUE = /^(?:data-|--)./;

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
 * Extracts top-level `export const NAME = '<data attribute or CSS variable>'` string
 * constants from a single module.
 *
 * @param {string} code
 * @param {string} file - Used only to pick the parser language.
 * @returns {Map<string, string>} Exported name to its literal value.
 */
function extractMetadataConstants(code, file) {
  /** @type {Map<string, string>} */
  const constants = new Map();
  if (!code.includes('data-') && !code.includes('--')) {
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
        INLINABLE_VALUE.test(declarator.init.value)
      ) {
        constants.set(declarator.id.name, declarator.init.value);
      }
    }
  }
  return constants;
}

/**
 * Scans the source tree for the exported metadata string constants that can be inlined.
 * Runs before the bundle so every module's constants are known regardless of build order.
 *
 * @param {string[]} files - Source paths relative to `sourceDir`.
 * @param {string} sourceDir - Absolute path to the package `src` directory.
 * @returns {Promise<Map<string, Map<string, string>>>} Absolute module path to its constants.
 */
export async function scanMetadataConstants(files, sourceDir) {
  /** @type {Map<string, Map<string, string>>} */
  const constantsByModule = new Map();
  await Promise.all(
    files.map(async (file) => {
      const absolute = path.join(sourceDir, file);
      const code = await fs.readFile(absolute, 'utf8');
      const constants = extractMetadataConstants(code, file);
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
 * A Babel plugin that inlines cross-module metadata string constants -- data attributes
 * (`data-open`) and CSS custom properties (`--popup-width`) -- at their call sites.
 *
 * Base UI declares these as `export const checked = 'data-checked'` /
 * `export const popupWidth = '--popup-width'` and reads them as
 * `import * as FooDataAttributes from './metadata'` / `FooDataAttributes.checked`, so the
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
export function createInlineMetadataConstantsPlugin({ constantsByModule, stats }) {
  return function inlineMetadataConstants({ types: t }) {
    return {
      name: 'inline-metadata-constants',
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
                if (
                  literal !== undefined &&
                  reference.parentPath &&
                  !isTypePositionReference(reference)
                ) {
                  reference.parentPath.replaceWith(t.stringLiteral(literal));
                  if (stats) {
                    stats.inlined += 1;
                  }
                } else {
                  // Keeps the import for anything not inlined, including type-position uses.
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
              let hasTypeUse = false;
              for (const reference of binding.referencePaths) {
                // `typeof NAME` (and other type positions) must stay an identifier;
                // preset-typescript removes them, so the binding is kept for them.
                if (isTypePositionReference(reference)) {
                  hasTypeUse = true;
                  continue;
                }
                reference.replaceWith(t.stringLiteral(literal));
                if (stats) {
                  stats.inlined += 1;
                }
              }
              if (!hasTypeUse) {
                removeSpecifier(importPath, specifierNode);
              }
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
 * True when a reference sits in a TypeScript type position, e.g. the `X` in
 * `typeof X` or `Record<typeof X, string>`. Such references must stay identifiers --
 * `typeof 'data-x'` is not valid syntax -- and are consumed by the type checker, not the
 * runtime, so they are left untouched (preset-typescript strips them from the output).
 * Babel's scope tracking counts them as references to the value binding, so they would
 * otherwise be rewritten alongside real value references.
 *
 * @param {import('@babel/core').NodePath} referencePath
 * @returns {boolean}
 */
function isTypePositionReference(referencePath) {
  return referencePath.find((ancestor) => ancestor.isTSType()) != null;
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
