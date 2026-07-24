/* eslint-disable no-console */

import { createRequire } from 'node:module';
import * as path from 'node:path';
import { parseAst } from 'rolldown/parseAst';

/**
 * @typedef {ReturnType<typeof parseAst>} Program
 * @typedef {Program['body'][number]} Statement
 * @typedef {{ start: number, end: number, text: string }} Edit
 */

/**
 * The helper rolldown currently uses to rebuild a namespace object. Detection does not rely
 * on this name -- `asSynthesizedNamespace` matches on shape -- but a leftover import of it is
 * checked for separately, so a shape change is reported rather than silently missed.
 */
const NAMESPACE_HELPER = '__exportAll';

/** Path fragment identifying the chunk rolldown emits its runtime helpers into. */
const RUNTIME_CHUNK = '_rolldown/runtime';

/**
 * Rolldown versions whose output shape has been verified against this rewrite. Rolldown is
 * pinned exactly in package.json, so this trips on a deliberate upgrade and forces the
 * output to be re-checked rather than assumed.
 */
const VALIDATED_ROLLDOWN_VERSIONS = new Set(['1.1.5']);

/**
 * Detects a synthesized namespace object by its *shape* rather than by the helper's name:
 * a module-scope `var X = <callee>({ a: () => a, b: () => b })` whose argument is an object
 * of arrow functions that each just return an identifier.
 *
 * Shape-based detection means a rolldown release that renames or re-paths the helper still
 * gets recognized instead of silently slipping through.
 *
 * @param {Statement} node
 * @returns {{ name: string, callee: string } | undefined}
 */
function asSynthesizedNamespace(node) {
  if (node.type !== 'VariableDeclaration' || node.declarations.length !== 1) {
    return undefined;
  }
  const [declarator] = node.declarations;
  const init = declarator.init;
  if (
    declarator.id.type !== 'Identifier' ||
    init?.type !== 'CallExpression' ||
    init.callee.type !== 'Identifier' ||
    init.arguments.length === 0 ||
    init.arguments[0].type !== 'ObjectExpression'
  ) {
    return undefined;
  }
  const properties = init.arguments[0].properties;
  const isGetterObject =
    properties.length > 0 &&
    properties.every(
      (property) =>
        property.type === 'Property' &&
        property.value.type === 'ArrowFunctionExpression' &&
        property.value.body.type === 'Identifier',
    );
  if (!isGetterObject) {
    return undefined;
  }
  return { name: declarator.id.name, callee: init.callee.name };
}

/**
 * @param {string} importerFileName
 * @param {string} specifier
 * @returns {string}
 */
function resolveToBundleKey(importerFileName, specifier) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(importerFileName), specifier));
}

/**
 * Applies non-overlapping edits, last to first so earlier offsets stay valid.
 *
 * @param {string} code
 * @param {Edit[]} edits
 * @returns {string}
 */
function applyEdits(code, edits) {
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((acc, edit) => acc.slice(0, edit.start) + edit.text + acc.slice(edit.end), code);
}

/**
 * Rewrites rolldown's synthesized namespace objects back to native ES namespace syntax.
 *
 * Under `preserveModules` every module is emitted as its own file, so the ES module system
 * already provides a namespace object for free. Rolldown synthesizes one anyway
 * (`var X_exports = __exportAll({ a: () => a })`), because its linker normally concatenates
 * modules and must reconstruct what scope hoisting destroyed. That premise does not hold
 * here, and the synthesized object is opaque to downstream bundlers: its getters reference
 * every export, so a consumer touching one property retains all of them.
 *
 * Rewriting `import { X_exports } from './x.js'` to `import * as X_exports from './x.js'`
 * restores a native namespace, which downstream bundlers can see through and tree-shake.
 *
 * Tracked upstream as https://github.com/rolldown/rolldown/issues/7874. Delete this once
 * rolldown can preserve the syntax itself.
 *
 * Every failure mode here is fatal by design. A silent no-op would ship a bundle that
 * defeats consumer tree-shaking with no indication anything went wrong, which is the exact
 * regression this exists to prevent.
 *
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {import('rolldown').Plugin}
 */
export function preserveNamespaces({ verbose = false } = {}) {
  return {
    name: 'code-infra-preserve-namespaces',

    buildStart() {
      // Guard 4 (version tripwire): this rewrite pattern-matches rolldown's output, so a
      // version bump has to be re-validated deliberately. Rolldown is pinned exactly, so
      // this only fires on an intentional upgrade.
      const version = createRequire(import.meta.url)('rolldown/package.json').version;
      if (!VALIDATED_ROLLDOWN_VERSIONS.has(version)) {
        throw new Error(
          `preserveNamespaces() has only been validated against rolldown ${[...VALIDATED_ROLLDOWN_VERSIONS].join(', ')}, but ${version} is installed. ` +
            `This rewrite depends on rolldown's output shape, so re-check that namespaces are still synthesized via ` +
            `${NAMESPACE_HELPER}() and that the rewrite still applies, then add ${version} to VALIDATED_ROLLDOWN_VERSIONS in ` +
            `packages/code-infra/src/utils/rolldownPreserveNamespaces.mjs. If rolldown has fixed ` +
            `https://github.com/rolldown/rolldown/issues/7874, delete this plugin instead.`,
        );
      }
    },

    generateBundle(_outputOptions, bundle) {
      /** @type {Map<string, { name: string, callee: string, start: number, end: number }>} */
      const synthesizedByFile = new Map();
      /** @type {Map<string, Program>} */
      const astByFile = new Map();

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') {
          continue;
        }
        const ast = parseAst(chunk.code, { sourceType: 'module' });
        astByFile.set(fileName, ast);
        for (const node of ast.body) {
          const synthesized = asSynthesizedNamespace(node);
          if (synthesized) {
            synthesizedByFile.set(fileName, { ...synthesized, start: node.start, end: node.end });
            break;
          }
        }
      }

      let rewrittenImports = 0;

      // Consumers: `import { X } from './x.js'` -> `import * as X from './x.js'`.
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') {
          continue;
        }
        const ast = astByFile.get(fileName);
        if (!ast) {
          continue;
        }
        /** @type {Edit[]} */
        const edits = [];

        for (const node of ast.body) {
          if (node.type !== 'ImportDeclaration' || !node.specifiers?.length) {
            continue;
          }
          const target = synthesizedByFile.get(resolveToBundleKey(fileName, node.source.value));
          if (!target) {
            continue;
          }
          const namespaceSpecifier = node.specifiers.find(
            (specifier) =>
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              specifier.imported.name === target.name,
          );
          if (!namespaceSpecifier) {
            continue;
          }
          // One declaration cannot mix named and namespace specifiers, so split them.
          const others = node.specifiers.filter((specifier) => specifier !== namespaceSpecifier);
          const source = JSON.stringify(node.source.value);
          const statements = [`import * as ${namespaceSpecifier.local.name} from ${source};`];
          if (others.length > 0) {
            const named = others
              .map((specifier) => chunk.code.slice(specifier.start, specifier.end))
              .join(', ');
            statements.push(`import { ${named} } from ${source};`);
          }
          edits.push({ start: node.start, end: node.end, text: statements.join('\n') });
          rewrittenImports += 1;
        }

        if (edits.length > 0) {
          chunk.code = applyEdits(chunk.code, edits);
        }
      }

      // Producers: drop the now-unreferenced namespace object, its export, and the helper import.
      for (const [fileName, target] of synthesizedByFile) {
        const chunk = bundle[fileName];
        if (chunk.type !== 'chunk') {
          continue;
        }
        const ast = parseAst(chunk.code, { sourceType: 'module' });
        const current = ast.body
          .map((node) => ({ node, synthesized: asSynthesizedNamespace(node) }))
          .find((entry) => entry.synthesized?.name === target.name);
        if (!current) {
          throw new Error(
            `Expected to find the synthesized namespace "${target.name}" in ${fileName} but it disappeared after rewriting imports.`,
          );
        }

        /** @type {Edit[]} */
        const edits = [{ start: current.node.start, end: current.node.end, text: '' }];

        for (const node of ast.body) {
          if (node.type === 'ExportNamedDeclaration' && node.specifiers?.length) {
            const kept = node.specifiers.filter(
              (specifier) =>
                !(specifier.local.type === 'Identifier' && specifier.local.name === target.name),
            );
            if (kept.length === node.specifiers.length) {
              continue;
            }
            const text =
              kept.length === 0
                ? ''
                : `export { ${kept.map((specifier) => chunk.code.slice(specifier.start, specifier.end)).join(', ')} };`;
            edits.push({ start: node.start, end: node.end, text });
          } else if (
            node.type === 'ImportDeclaration' &&
            node.specifiers?.some(
              (specifier) =>
                specifier.type === 'ImportSpecifier' &&
                specifier.imported.type === 'Identifier' &&
                specifier.imported.name === target.callee,
            )
          ) {
            edits.push({ start: node.start, end: node.end, text: '' });
          }
        }

        chunk.code = applyEdits(chunk.code, edits);
      }

      // No synthesized namespace may survive, checked on two independent axes so that a
      // rolldown change blinding one is still caught by the other:
      //   - by shape, which also covers a renamed helper;
      //   - by the helper's name, which covers a new shape `asSynthesizedNamespace` (and
      //     therefore the rewrite itself) no longer recognizes.
      // Anything left here would silently defeat consumer tree-shaking, so both are fatal.
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') {
          continue;
        }
        // Deliberately not prefiltered on the helper's name: the shape axis exists to catch a
        // renamed helper, and skipping chunks that no longer mention the old name would blind
        // it to exactly that case.
        for (const node of parseAst(chunk.code, { sourceType: 'module' }).body) {
          const leftover = asSynthesizedNamespace(node);
          if (leftover) {
            throw new Error(
              `${fileName} still synthesizes a namespace object "${leftover.name}" via ${leftover.callee}() after post-processing. ` +
                `Rolldown's output shape has changed (this used to be ${NAMESPACE_HELPER}); update preserveNamespaces() in ` +
                `packages/code-infra/src/utils/rolldownPreserveNamespaces.mjs. See https://github.com/rolldown/rolldown/issues/7874`,
            );
          }
          const importsHelper =
            node.type === 'ImportDeclaration' &&
            !fileName.includes(RUNTIME_CHUNK) &&
            node.specifiers?.some(
              (specifier) =>
                specifier.type === 'ImportSpecifier' &&
                specifier.imported.type === 'Identifier' &&
                specifier.imported.name === NAMESPACE_HELPER,
            );
          if (importsHelper) {
            throw new Error(
              `${fileName} still imports ${NAMESPACE_HELPER}() after post-processing, so it carries a namespace object that ` +
                `preserveNamespaces() did not recognize. Rolldown's emit shape has likely changed. Leaving it in place would ` +
                `silently defeat consumer tree-shaking, so this is fatal. Update ` +
                `packages/code-infra/src/utils/rolldownPreserveNamespaces.mjs. ` +
                `See https://github.com/rolldown/rolldown/issues/7874`,
            );
          }
        }
      }

      // The runtime chunk may now be unreferenced. This reads the emitted text rather than
      // `chunk.imports`, because that metadata was computed before the rewrite above removed
      // the import statements and so still lists the runtime chunk as a dependency.
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !fileName.includes(RUNTIME_CHUNK)) {
          continue;
        }
        const basename = path.posix.basename(fileName);
        const stillUsed = Object.values(bundle).some(
          (other) => other !== chunk && other.type === 'chunk' && other.code.includes(basename),
        );
        if (!stillUsed) {
          delete bundle[fileName];
          if (verbose) {
            console.log(`Removed now-unused ${fileName}`);
          }
        }
      }

      if (verbose && synthesizedByFile.size > 0) {
        console.log(
          `Restored ${synthesizedByFile.size} native namespace(s) across ${rewrittenImports} import(s).`,
        );
      }
    },
  };
}
