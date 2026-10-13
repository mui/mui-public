import * as path from 'node:path';
import { types as t } from '@babel/core';

/** @typedef {{ file: string; name: string; literal?: string }} ExportBinding */

/**
 * Flatten named imports through pure barrels and inline immutable metadata
 * strings. Original imports remain for evaluation order and transitive effects.
 * Namespace objects and directive-bearing modules retain their boundaries.
 * @param {Map<string, { ast: import('@babel/core').types.File; directives: string[] }>} modules
 * @returns {(api: typeof import('@babel/core')) => import('@babel/core').PluginObject}
 */
export function libraryImports(modules) {
  const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
  /** @param {string} id @param {string} importer */
  function resolve(id, importer) {
    if (!id.startsWith('.')) {
      return undefined;
    }
    const base = path.resolve(path.dirname(importer), id);
    const stem = /\.[cm]?js$/.test(base) ? base.slice(0, -path.extname(base).length) : base;
    return [
      base,
      ...extensions.map((ext) => stem + ext),
      ...extensions.map((ext) => path.join(base, `index${ext}`)),
    ].find((file) => modules.has(file));
  }

  /** @type {Map<string, string[]>} */
  const dependencies = new Map();
  const unknownDependencies = new Set();
  for (const [file, module] of modules) {
    /** @type {string[]} */
    const edges = [];
    t.traverseFast(module.ast, (node) => {
      let source;
      if (
        t.isImportDeclaration(node) ||
        t.isExportNamedDeclaration(node) ||
        t.isExportAllDeclaration(node)
      ) {
        source = node.source?.value;
      } else if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: 'require' }) &&
        t.isStringLiteral(node.arguments[0])
      ) {
        source = node.arguments[0].value;
      } else if (t.isImportExpression(node) && t.isStringLiteral(node.source)) {
        source = node.source.value;
      }
      if (source) {
        const target = resolve(source, file);
        if (target) {
          edges.push(target);
        } else if (!source.startsWith('node:')) {
          unknownDependencies.add(file);
        }
      }
    });
    dependencies.set(file, edges);
  }
  // Tarjan's strongly connected components identify all cycle participants,
  // including cycles that involve ordinary imports rather than re-exports.
  const indices = new Map();
  const low = new Map();
  /** @type {string[]} */
  const stack = [];
  const active = new Set();
  const cyclic = new Set();
  /** @param {string} file */
  function visit(file) {
    const index = indices.size;
    indices.set(file, index);
    low.set(file, index);
    stack.push(file);
    active.add(file);
    for (const target of dependencies.get(file) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(file, Math.min(low.get(file), low.get(target)));
      } else if (active.has(target)) {
        low.set(file, Math.min(low.get(file), indices.get(target)));
      }
    }
    if (low.get(file) === index) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        if (member === undefined) {
          throw new Error('Invalid library dependency stack');
        }
        active.delete(member);
        component.push(member);
      } while (member !== file);
      if (component.length > 1 || dependencies.get(file)?.includes(file)) {
        for (const entry of component) {
          cyclic.add(entry);
        }
      }
    }
  }
  for (const file of modules.keys()) {
    if (!indices.has(file)) {
      visit(file);
    }
  }

  /** @type {Map<string, Map<string, ExportBinding>>} */
  const cache = new Map();
  /** @param {string} file @param {Set<string>} [ancestors] @returns {Map<string, ExportBinding> | undefined} */
  function exportsOf(file, ancestors = new Set()) {
    if (cyclic.has(file) || ancestors.has(file)) {
      return undefined;
    }
    const cached = cache.get(file);
    if (cached) {
      return cached;
    }
    const module = modules.get(file);
    if (!module) {
      return undefined;
    }
    const body = module.ast.program.body;
    const boundary = module.directives.some((directive) => directive !== 'use strict');
    const barrel =
      !boundary &&
      body.every(
        (node) =>
          t.isExportAllDeclaration(node) ||
          (t.isExportNamedDeclaration(node) && Boolean(node.source)),
      );
    const metadata =
      !boundary &&
      body.length > 0 &&
      body.every(
        (node) =>
          t.isExportNamedDeclaration(node) &&
          t.isVariableDeclaration(node.declaration, { kind: 'const' }) &&
          node.declaration.declarations.every(
            (decl) => t.isIdentifier(decl.id) && t.isStringLiteral(decl.init),
          ),
      );
    const next = new Set(ancestors).add(file);
    /** @type {Map<string, ExportBinding>} */
    const result = new Map();
    const ambiguous = new Set();
    for (const node of body) {
      if (t.isExportDefaultDeclaration(node)) {
        result.set('default', { file, name: 'default' });
      } else if (t.isExportNamedDeclaration(node) && node.exportKind !== 'type') {
        if (node.declaration) {
          for (const name of Object.keys(t.getOuterBindingIdentifiers(node.declaration))) {
            result.set(name, { file, name });
          }
          if (metadata && t.isVariableDeclaration(node.declaration)) {
            for (const decl of node.declaration.declarations) {
              if (
                t.isIdentifier(decl.id) &&
                t.isStringLiteral(decl.init) &&
                /^(data-|--)./.test(decl.init.value)
              ) {
                result.set(decl.id.name, { file, name: decl.id.name, literal: decl.init.value });
              }
            }
          }
        }
        for (const specifier of node.specifiers) {
          const name = t.isIdentifier(specifier.exported)
            ? specifier.exported.name
            : specifier.exported.value;
          let binding = { file, name };
          if (
            barrel &&
            node.source &&
            t.isExportSpecifier(specifier) &&
            specifier.exportKind !== 'type'
          ) {
            const target = resolve(node.source.value, file);
            const forwarded = target ? exportsOf(target, next) : undefined;
            if (target && !forwarded) {
              return undefined;
            }
            const local = t.isIdentifier(specifier.local)
              ? specifier.local.name
              : specifier.local.value;
            binding = forwarded?.get(local) ?? binding;
          }
          result.set(name, binding);
        }
      } else if (t.isExportAllDeclaration(node) && node.exportKind !== 'type') {
        const target = resolve(node.source.value, file);
        const forwarded = target ? exportsOf(target, next) : undefined;
        // Unknown star exports can introduce ambiguities we cannot resolve safely.
        if (!forwarded) {
          return undefined;
        }
        for (const [name, binding] of forwarded) {
          if (name === 'default') {
            continue;
          }
          const previous = result.get(name);
          if (previous && (previous.file !== binding.file || previous.name !== binding.name)) {
            ambiguous.add(name);
          }
          result.set(name, barrel ? binding : { file, name });
        }
      }
    }
    for (const name of ambiguous) {
      result.delete(name);
    }
    // Cycle participants were excluded above, so successful resolutions form a DAG.
    cache.set(file, result);
    return result;
  }

  return () => ({
    name: 'mui-library-imports',
    visitor: {
      Program(programPath, state) {
        if (!state.filename) {
          return;
        }
        const filename = state.filename;
        if (cyclic.has(filename)) {
          return;
        }
        /** @type {Map<import('@babel/core').types.Statement, import('@babel/core').types.Statement[]>} */
        const replacements = new Map();
        for (const importPath of programPath.get('body')) {
          if (
            !importPath.isImportDeclaration() ||
            importPath.node.importKind === 'type' ||
            importPath.node.attributes?.length
          ) {
            continue;
          }
          const target = resolve(importPath.node.source.value, filename);
          const exports = target ? exportsOf(target) : undefined;
          if (!exports) {
            continue;
          }
          const retained = [];
          const forwarded = [];
          for (const specifier of importPath.node.specifiers) {
            const binding = importPath.scope.getBinding(specifier.local.name);
            if (!binding) {
              retained.push(specifier);
              continue;
            }
            const named = t.isImportSpecifier(specifier) && specifier.importKind !== 'type';
            let name;
            if (named) {
              name = t.isIdentifier(specifier.imported)
                ? specifier.imported.name
                : specifier.imported.value;
            } else if (t.isImportDefaultSpecifier(specifier)) {
              name = 'default';
            }
            const exported = name !== undefined ? exports.get(name) : undefined;
            let remaining = false;
            for (const reference of binding.referencePaths) {
              const typePosition = reference.findParent((parent) => parent.isTSType());
              const member = reference.parentPath;
              let literal = exported?.literal;
              if (
                t.isImportNamespaceSpecifier(specifier) &&
                member?.isMemberExpression() &&
                member.node.object === reference.node
              ) {
                const key = member.node.computed ? member.node.property : null;
                let property;
                if (t.isStringLiteral(key)) {
                  property = key.value;
                } else if (!member.node.computed && t.isIdentifier(member.node.property)) {
                  property = member.node.property.name;
                }
                literal = property ? exports.get(property)?.literal : undefined;
              }
              if (
                literal !== undefined &&
                !typePosition &&
                !reference.parentPath?.isExportSpecifier()
              ) {
                const valuePath = t.isImportNamespaceSpecifier(specifier) ? member : reference;
                const parent = valuePath?.parentPath;
                const write =
                  parent?.isUpdateExpression() ||
                  parent?.isUnaryExpression({ operator: 'delete' }) ||
                  (parent?.isAssignmentExpression() && parent.node.left === valuePath?.node);
                // A hoisted function can run before its module's dependencies
                // initialize. Unknown package edges may conceal an external cycle.
                const hoisted =
                  unknownDependencies.has(filename) &&
                  reference.findParent(
                    (node) =>
                      (node.isFunctionDeclaration() && node.parentPath?.isProgram()) ||
                      (node.isFunctionDeclaration() && node.parentPath?.isExportDeclaration()),
                  );
                if (valuePath?.isReferenced() && !write && !hoisted) {
                  valuePath.replaceWith(t.stringLiteral(literal));
                  continue;
                }
              }
              remaining = true;
            }
            if (!remaining && binding.constantViolations.length === 0) {
              continue;
            }
            if (exported && exported.file !== target && binding.constantViolations.length === 0) {
              let relative = path
                .relative(path.dirname(filename), exported.file)
                .split(path.sep)
                .join('/');
              if (!relative.startsWith('.')) {
                relative = `./${relative}`;
              }
              forwarded.push(
                t.importDeclaration(
                  [
                    t.importSpecifier(
                      t.cloneNode(specifier.local),
                      t.isValidIdentifier(exported.name)
                        ? t.identifier(exported.name)
                        : t.stringLiteral(exported.name),
                    ),
                  ],
                  t.stringLiteral(relative),
                ),
              );
            } else {
              retained.push(specifier);
            }
          }
          if (retained.length !== importPath.node.specifiers.length || forwarded.length) {
            const original = t.cloneNode(importPath.node);
            original.specifiers = retained;
            // A bare original import preserves evaluation and side effects, including
            // transitive effects of every module the barrel re-exports.
            replacements.set(importPath.node, [original, ...forwarded]);
          }
        }
        programPath.node.body = programPath.node.body.flatMap(
          (node) => replacements.get(node) ?? [node],
        );
      },
    },
  });
}
