import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import { JS_TS_EXTENSIONS } from './build.mjs';

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

/** Probed, in order, when resolving an extensionless relative import to a source file. */
const RESOLVE_EXTENSIONS = [...JS_TS_EXTENSIONS];

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
 * @typedef {{ specifier: string, importedName: string }} AliasTarget
 * @typedef {{ literals: Map<string, string>, aliases: Map<string, AliasTarget>, stars: string[] }} ModuleExports
 */

/**
 * Reads a module's inlinable exports: the ones assigned a literal directly, and the ones that
 * merely forward another module's export. Base UI shares values between components that way --
 * `export const popupOpen = CommonTriggerDataAttributes.popupOpen` -- so the forwarding exports
 * have to be followed to reach the literal, otherwise every consumer of the forwarding module
 * misses out on inlining.
 *
 * @param {string} code
 * @param {string} file - Used only to pick the parser language.
 * @returns {ModuleExports}
 */
function extractModuleExports(code, file) {
  /** @type {Map<string, string>} */
  const literals = new Map();
  /** @type {Map<string, AliasTarget>} */
  const aliases = new Map();
  /** @type {string[]} */
  const stars = [];

  // Every contributing form needs one of these, so anything else can skip the parse. Text
  // matching can only ever miss a constant, which costs an optimization rather than
  // correctness, and it keeps the scan off the ~80% of files that export nothing relevant.
  if (!code.includes('export const') && !code.includes('export {') && !code.includes('export *')) {
    return { literals, aliases, stars };
  }

  const ast = parseAst(code, { lang: langForFile(file) });

  // Local bindings introduced by imports. `importedName` is null for a namespace import,
  // whose members name the export instead.
  /** @type {Map<string, { specifier: string, importedName: string | null }>} */
  const importBindings = new Map();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || typeof node.source.value !== 'string') {
      continue;
    }
    for (const specifier of node.specifiers ?? []) {
      if (specifier.type === 'ImportSpecifier') {
        importBindings.set(specifier.local.name, {
          specifier: node.source.value,
          importedName:
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : String(specifier.imported.value),
        });
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        importBindings.set(specifier.local.name, {
          specifier: node.source.value,
          importedName: null,
        });
      }
    }
  }

  for (const node of ast.body) {
    // `export * from './x'` forwards every one of x's exports under its own name. (An
    // `export * as Ns` re-exports a namespace object, not individual constants, so it is
    // skipped -- it has an `exported` name.)
    if (
      node.type === 'ExportAllDeclaration' &&
      !node.exported &&
      typeof node.source.value === 'string'
    ) {
      stars.push(node.source.value);
      continue;
    }
    if (node.type !== 'ExportNamedDeclaration') {
      continue;
    }

    // `export { open } from './common'` forwards without introducing a local binding.
    if (node.source && node.specifiers?.length) {
      for (const specifier of node.specifiers) {
        const local =
          specifier.local.type === 'Identifier'
            ? specifier.local.name
            : String(specifier.local.value);
        const exported =
          specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : String(specifier.exported.value);
        aliases.set(exported, { specifier: node.source.value, importedName: local });
      }
      continue;
    }

    if (node.declaration?.type !== 'VariableDeclaration' || node.declaration.kind !== 'const') {
      continue;
    }

    for (const declarator of node.declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) {
        continue;
      }
      const name = declarator.id.name;
      const init = declarator.init;

      if (init.type === 'Literal' && typeof init.value === 'string') {
        if (INLINABLE_VALUE.test(init.value)) {
          literals.set(name, init.value);
        }
      } else if (init.type === 'Identifier') {
        // `export const open = importedOpen`
        const binding = importBindings.get(init.name);
        if (binding?.importedName) {
          aliases.set(name, {
            specifier: binding.specifier,
            importedName: binding.importedName,
          });
        }
      } else if (init.type === 'MemberExpression' && init.object.type === 'Identifier') {
        // `export const open = CommonDataAttributes.open`
        const binding = importBindings.get(init.object.name);
        // the member names the export, for `ns.open` and `ns['open']` alike
        let member;
        if (!init.computed && init.property.type === 'Identifier') {
          member = init.property.name;
        } else if (
          init.computed &&
          init.property.type === 'Literal' &&
          typeof init.property.value === 'string'
        ) {
          member = init.property.value;
        }
        if (binding && binding.importedName === null && member) {
          aliases.set(name, { specifier: binding.specifier, importedName: member });
        }
      }
    }
  }

  return { literals, aliases, stars };
}

/**
 * Resolves a relative import specifier to a known module path, probing the same extensions and
 * index files Node's ESM resolver would.
 *
 * @param {string} importerAbsolute
 * @param {string} specifier
 * @param {(candidate: string) => boolean} isKnownModule
 * @returns {string | undefined}
 */
function resolveRelativeModule(importerAbsolute, specifier, isKnownModule) {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = path.resolve(path.dirname(importerAbsolute), specifier);
  return [
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => base + extension),
    ...RESOLVE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ].find(isKnownModule);
}

/**
 * Scans the source tree for the exported metadata string constants that can be inlined,
 * following forwarding exports until they reach a literal. Runs before the bundle so every
 * module's constants are known regardless of build order.
 *
 * @param {string[]} files - Source paths relative to `sourceDir`.
 * @param {string} sourceDir - Absolute path to the package `src` directory.
 * @returns {Promise<Map<string, Map<string, string>>>} Absolute module path to its constants.
 */
export async function scanMetadataConstants(files, sourceDir) {
  /** @type {Map<string, ModuleExports>} */
  const exportsByModule = new Map();
  await Promise.all(
    files.map(async (file) => {
      const absolute = path.join(sourceDir, file);
      const code = await fs.readFile(absolute, 'utf8');
      exportsByModule.set(absolute, extractModuleExports(code, file));
    }),
  );

  /**
   * @param {string} moduleId
   * @param {string} specifier
   * @returns {string | undefined}
   */
  const resolveTarget = (moduleId, specifier) =>
    resolveRelativeModule(moduleId, specifier, (candidate) => exportsByModule.has(candidate));

  /** @type {Map<string, Map<string, string>>} Fully resolved constants, memoized per module. */
  const resolved = new Map();
  /** Modules currently being resolved; re-entering one is a cycle and contributes nothing. */
  const inProgress = new Set();

  /**
   * Every inlinable constant a module exposes, following named/aliased forwards and `export *`
   * re-exports until each reaches a literal. Cycles (a source error, not something to inline)
   * break to an empty contribution.
   *
   * @param {string} moduleId
   * @returns {Map<string, string>}
   */
  function collectConstants(moduleId) {
    const cached = resolved.get(moduleId);
    if (cached) {
      return cached;
    }
    if (inProgress.has(moduleId)) {
      return new Map();
    }
    inProgress.add(moduleId);

    const moduleExports = exportsByModule.get(moduleId);
    const constants = new Map(moduleExports?.literals);

    // `export * from './x'` forwards x's own exports. A module's own named exports win over
    // its star ones, matching ESM's local-first resolution, so stars fill in first.
    for (const specifier of moduleExports?.stars ?? []) {
      const targetId = resolveTarget(moduleId, specifier);
      if (targetId) {
        for (const [name, value] of collectConstants(targetId)) {
          if (!constants.has(name)) {
            constants.set(name, value);
          }
        }
      }
    }

    for (const [name, alias] of moduleExports?.aliases ?? []) {
      const targetId = resolveTarget(moduleId, alias.specifier);
      const value = targetId && collectConstants(targetId).get(alias.importedName);
      if (value !== undefined) {
        constants.set(name, value);
      }
    }

    inProgress.delete(moduleId);
    resolved.set(moduleId, constants);
    return constants;
  }

  /** @type {Map<string, Map<string, string>>} */
  const constantsByModule = new Map();
  for (const moduleId of exportsByModule.keys()) {
    const constants = collectConstants(moduleId);
    if (constants.size > 0) {
      constantsByModule.set(moduleId, constants);
    }
  }
  return constantsByModule;
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
  // A candidate can only live in the directory holding a constants module, or be that
  // directory's `index`. Checking that first rejects almost every import in one lookup,
  // before `resolveRelativeModule` builds its candidate list.
  const constantModuleDirs = new Set(
    [...constantsByModule.keys()].map((moduleId) => path.dirname(moduleId)),
  );

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
          const base = path.resolve(path.dirname(importerAbsolute), specifier);
          if (!constantModuleDirs.has(path.dirname(base)) && !constantModuleDirs.has(base)) {
            return;
          }
          const moduleId = resolveRelativeModule(importerAbsolute, specifier, (candidate) =>
            constantsByModule.has(candidate),
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
              let hasRetainedUse = false;
              for (const reference of binding.referencePaths) {
                // Some positions cannot hold a string literal (a `typeof NAME` type, a bare
                // `export { NAME }` re-export), so the binding is kept for them instead.
                if (isNonInlinablePosition(reference)) {
                  hasRetainedUse = true;
                  continue;
                }
                reference.replaceWith(t.stringLiteral(literal));
                if (stats) {
                  stats.inlined += 1;
                }
              }
              if (!hasRetainedUse) {
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
  // A TS type node always sits below the enclosing statement, so stopping there bounds the
  // walk to a few levels instead of climbing to the Program root for every value reference.
  const ancestor = referencePath.find((node) => node.isTSType() || node.isStatement());
  return ancestor?.isTSType() === true;
}

/**
 * True when a reference cannot be replaced with a string literal, so the imported binding
 * must be kept for it: a TypeScript type position, or the `local` of a bare `export { NAME }`
 * re-export (whose `local` must stay an identifier).
 *
 * @param {import('@babel/core').NodePath} referencePath
 * @returns {boolean}
 */
function isNonInlinablePosition(referencePath) {
  const parent = referencePath.parentPath;
  if (parent?.isExportSpecifier() && parent.node.local === referencePath.node) {
    return true;
  }
  return isTypePositionReference(referencePath);
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
