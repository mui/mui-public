import * as path from 'node:path';
import { RolldownMagicString } from 'rolldown';
import { parse } from 'rolldown/utils';

const DTS_FILES = /\.d\.[cm]?ts$/;

const GENERATED_NAMESPACE = /_exports$/;

/**
 * @typedef {{ start: number; end: number; text: string }} Edit
 * @typedef {import('rolldown/utils').ESTree.Node} Node
 * @typedef {import('rolldown/utils').ESTree.ModuleExportName | import('rolldown/utils').ESTree.BindingIdentifier} Name
 */

/**
 * @param {string} code
 * @param {Edit[]} edits
 */
function applyEdits(code, edits) {
  const result = new RolldownMagicString(code);
  for (const { start, end, text } of edits) {
    if (text) {
      result.update(start, end, text);
    } else {
      result.remove(start, end);
    }
  }
  return result.toString();
}

/** @param {Name} node */
function getName(node) {
  return node.type === 'Identifier' ? node.name : String(node.value);
}

/** @param {import('tsdown').Rolldown.OutputChunk} chunk */
async function parseChunk(chunk) {
  const { program } = await parse(chunk.fileName, chunk.code, { lang: 'js' });
  return program.body;
}

/** @param {Name} node */
function printName(node) {
  return node.type === 'Identifier' ? node.name : JSON.stringify(node.value);
}

/**
 * The `__reExport()` calls filling namespace `name`, and whether the module reads it beyond
 * those, its declaration and its exports.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 * @param {Node[]} body
 * @param {string} name
 */
function getOwnStatements(chunk, body, name) {
  const reExports = body.filter(
    (statement) =>
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'CallExpression' &&
      statement.expression.callee.type === 'Identifier' &&
      statement.expression.callee.name === '__reExport' &&
      statement.expression.arguments[0]?.type === 'Identifier' &&
      statement.expression.arguments[0].name === name,
  );
  const exports = body.flatMap((statement) =>
    statement.type === 'ExportNamedDeclaration' && !statement.source
      ? statement.specifiers.filter(
          (specifier) => specifier.type === 'ExportSpecifier' && getName(specifier.local) === name,
        )
      : [],
  );
  const usedLocally = countReferences(chunk.code, name) !== 1 + reExports.length + exports.length;
  return { reExports, usedLocally };
}

/**
 * The `__exportAll()` namespaces of `chunk` whose members it all exports by name and that it
 * doesn't read itself, so `import * as` can stand in for them. Rolldown can inline constants into the object instead.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 */
async function getNamespaces(chunk) {
  const exported = new Set(chunk.exports);
  /** @type {Set<string>} */
  const namespaces = new Set();
  const body = await parseChunk(chunk);
  for (const node of body) {
    const declarator = node.type === 'VariableDeclaration' ? node.declarations[0] : null;
    const init = declarator?.init;
    if (
      declarator?.id.type !== 'Identifier' ||
      !GENERATED_NAMESPACE.test(declarator.id.name) ||
      init?.type !== 'CallExpression' ||
      init.callee.type !== 'Identifier' ||
      init.callee.name !== '__exportAll' ||
      init.arguments[0]?.type !== 'ObjectExpression'
    ) {
      continue;
    }
    const complete = init.arguments[0].properties.every(
      (property) =>
        property.type === 'Property' &&
        !property.computed &&
        (property.key.type === 'Identifier' || property.key.type === 'Literal') &&
        exported.has(
          property.key.type === 'Identifier' ? property.key.name : String(property.key.value),
        ),
    );
    // Rewriting would leave the module's own references on a second, different object.
    if (complete && !getOwnStatements(chunk, body, declarator.id.name).usedLocally) {
      namespaces.add(declarator.id.name);
    }
  }
  return namespaces;
}

/**
 * @param {string} code
 * @param {string} name
 */
function countReferences(code, name) {
  const escaped = name.replace(/[$]/g, '\\$&');
  return code.match(new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g'))?.length ?? 0;
}

/**
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 * @param {Node} node
 */
function slice(chunk, node) {
  return chunk.code.slice(node.start, node.end);
}

/**
 * @param {Node} node
 * @param {string} text
 * @returns {Edit}
 */
function replace(node, text) {
  return { start: node.start, end: node.end, text };
}

/**
 * The names each chunk is imported by, keyed by its file name.
 * @param {import('tsdown').Rolldown.OutputChunk[]} chunks
 */
async function getImportedNames(chunks) {
  const bodies = await Promise.all(chunks.map(parseChunk));
  /** @type {Map<string, Set<string>>} */
  const imported = new Map();
  for (const [index, chunk] of chunks.entries()) {
    for (const node of bodies[index]) {
      if (
        (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration') ||
        !node.source?.value.startsWith('.')
      ) {
        continue;
      }
      const target = path.posix.join(path.posix.dirname(chunk.fileName), node.source.value);
      const names = imported.get(target) ?? new Set();
      imported.set(target, names);
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          names.add(getName(specifier.imported));
        } else if (specifier.type === 'ExportSpecifier') {
          names.add(getName(specifier.local));
        }
      }
    }
  }
  return imported;
}

/**
 * Removes `__exportAll()` namespace objects nothing references any more, and their exports.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 * @param {Set<string>} imported Names other chunks import from `chunk`.
 */
async function dropUnusedNamespaces(chunk, imported) {
  const body = await parseChunk(chunk);
  /** @type {Edit[]} */
  const edits = [];
  /** @type {Set<string>} */
  const dropped = new Set();
  for (const node of body) {
    const declarator = node.type === 'VariableDeclaration' ? node.declarations[0] : null;
    if (
      declarator?.id.type !== 'Identifier' ||
      !GENERATED_NAMESPACE.test(declarator.id.name) ||
      declarator.init?.type !== 'CallExpression' ||
      declarator.init.callee.type !== 'Identifier' ||
      declarator.init.callee.name !== '__exportAll' ||
      imported.has(declarator.id.name)
    ) {
      continue;
    }
    const name = declarator.id.name;
    const { reExports, usedLocally } = getOwnStatements(chunk, body, name);
    if (usedLocally) {
      continue;
    }
    dropped.add(name);
    edits.push(replace(node, ''), ...reExports.map((statement) => replace(statement, '')));
  }
  if (dropped.size === 0) {
    return;
  }
  for (const node of body) {
    if (node.type !== 'ExportNamedDeclaration' || node.source || node.declaration) {
      continue;
    }
    const kept = node.specifiers.filter(
      (specifier) => specifier.type !== 'ExportSpecifier' || !dropped.has(getName(specifier.local)),
    );
    if (kept.length === node.specifiers.length) {
      continue;
    }
    edits.push(
      replace(node, `export { ${kept.map((specifier) => slice(chunk, specifier)).join(', ')} };`),
    );
  }
  chunk.code = applyEdits(chunk.code, edits);
  await dropUnusedImports(chunk);
}

/**
 * Removes the imports the dropped namespaces used: runtime helpers and namespaces they re-exported.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 */
async function dropUnusedImports(chunk) {
  /** @type {Edit[]} */
  const edits = [];
  for (const node of await parseChunk(chunk)) {
    if (node.type !== 'ImportDeclaration') {
      continue;
    }
    const kept = node.specifiers.filter(
      (specifier) =>
        !(
          specifier.type === 'ImportNamespaceSpecifier' ||
          (specifier.type === 'ImportSpecifier' &&
            ['__exportAll', '__reExport'].includes(getName(specifier.imported)))
        ) || countReferences(chunk.code, specifier.local.name) > 1,
    );
    if (kept.length === node.specifiers.length) {
      continue;
    }
    if (kept.length === 0) {
      edits.push(replace(node, ''));
      continue;
    }
    edits.push(
      replace(
        node,
        `import { ${kept.map((specifier) => slice(chunk, specifier)).join(', ')} } from ${JSON.stringify(node.source.value)};`,
      ),
    );
  }
  chunk.code = applyEdits(chunk.code, edits);
}

/**
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 * @param {Map<string, Set<string>>} rewritable The rewritable namespaces, keyed by file name.
 */
async function rewriteImports(chunk, rewritable) {
  /** @type {Edit[]} */
  const edits = [];
  for (const node of await parseChunk(chunk)) {
    if (
      (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration') ||
      !node.source?.value.startsWith('.')
    ) {
      continue;
    }
    const target = rewritable.get(
      path.posix.join(path.posix.dirname(chunk.fileName), node.source.value),
    );
    const source = JSON.stringify(node.source.value);
    const keyword = node.type === 'ImportDeclaration' ? 'import' : 'export';
    /** @type {string[]} */
    const rest = [];
    /** @type {string[]} */
    const namespaces = [];
    for (const specifier of node.specifiers) {
      /** @type {[Name, Name] | []} */
      let binding = [];
      if (specifier.type === 'ImportSpecifier') {
        binding = [specifier.imported, specifier.local];
      } else if (specifier.type === 'ExportSpecifier') {
        binding = [specifier.local, specifier.exported];
      }
      const [imported, alias] = binding;
      const name = imported ? getName(imported) : null;
      if (!name || !alias || !target?.has(name)) {
        rest.push(slice(chunk, specifier));
        continue;
      }
      namespaces.push(`${keyword} * as ${printName(alias)} from ${source};`);
    }
    if (namespaces.length === 0) {
      continue;
    }
    if (rest.length > 0) {
      namespaces.unshift(`${keyword} { ${rest.join(', ')} } from ${source};`);
    }
    edits.push(replace(node, namespaces.join('\n')));
  }
  chunk.code = applyEdits(chunk.code, edits);
}

/**
 * Rolldown turns `export * as X from './parts'` into an `__exportAll()` object holding every
 * export, which bundlers can't tree-shake. Rolldown also reads names an external `export *` provides
 * through that object. ESM chunks import such namespaces with `import * as` instead, and objects
 * nothing references any more are removed with their `<name>_exports` export.
 * Remove this plugin once Rolldown keeps namespace re-exports in unbundled builds.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function jsNamespacesPlugin() {
  return {
    name: 'code-infra:js-namespaces',
    async generateBundle(options, bundle) {
      if (options.format !== 'es') {
        return;
      }
      const chunks = Object.values(bundle).filter(
        /** @returns {output is import('tsdown').Rolldown.OutputChunk} */
        (output) => output.type === 'chunk' && !DTS_FILES.test(output.fileName),
      );
      const namespaces = new Map(
        await Promise.all(
          chunks.map(
            async (chunk) => /** @type {const} */ ([chunk.fileName, await getNamespaces(chunk)]),
          ),
        ),
      );
      await Promise.all(chunks.map((chunk) => rewriteImports(chunk, namespaces)));
      const imported = await getImportedNames(chunks);
      await Promise.all(
        chunks.map((chunk) =>
          dropUnusedNamespaces(chunk, imported.get(chunk.fileName) ?? new Set()),
        ),
      );
    },
  };
}
