import * as path from 'node:path';
import { RolldownMagicString } from 'rolldown';
import { parse } from 'rolldown/utils';

const DTS_FILES = /\.d\.[cm]?ts$/;

const GENERATED_NAMESPACE = /_exports$/;

/** @typedef {import('rolldown/utils').ESTree.Node} Node */
/** @typedef {import('rolldown/utils').ESTree.ModuleExportName | import('rolldown/utils').ESTree.BindingIdentifier} Name */

/**
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 */
async function parseChunk(chunk) {
  const { program } = await parse(chunk.fileName, chunk.code, { lang: 'dts' });
  return program.body;
}

/**
 * @typedef {Object} Namespace
 * @property {string} local The binding the module exports the namespace by.
 * @property {Node} node The declaration or import that creates it.
 */

/**
 * The `<name>_exports` namespaces Rolldown creates for a module's namespace object: a declared
 * namespace, or a package's namespace a module only re-exports.
 * @param {Awaited<ReturnType<typeof parseChunk>>} body
 * @returns {Map<string, Namespace>}
 */
function getNamespaces(body) {
  /** @type {Map<string, import('rolldown/utils').ESTree.ImportDeclaration>} */
  const packageNamespaces = new Map();
  /** @type {Map<string, Namespace>} */
  const namespaces = new Map();
  for (const node of body) {
    if (
      node.type === 'ImportDeclaration' &&
      !node.source.value.startsWith('.') &&
      node.specifiers.length === 1 &&
      node.specifiers[0].type === 'ImportNamespaceSpecifier'
    ) {
      packageNamespaces.set(node.specifiers[0].local.name, node);
      continue;
    }
    if (
      node.type === 'TSModuleDeclaration' &&
      node.declare &&
      node.id.type === 'Identifier' &&
      GENERATED_NAMESPACE.test(node.id.name) &&
      node.body?.type === 'TSModuleBlock' &&
      node.body.body.every((child) => child.type === 'ExportNamedDeclaration' && !child.source)
    ) {
      namespaces.set(node.id.name, { local: node.id.name, node });
    }
  }

  for (const node of body) {
    if (node.type !== 'ExportNamedDeclaration' || node.source || node.declaration) {
      continue;
    }
    for (const specifier of node.specifiers) {
      const [local, exported] = getBinding(specifier);
      const imported = local && packageNamespaces.get(getName(local));
      if (!imported || !exported || !GENERATED_NAMESPACE.test(getName(exported))) {
        continue;
      }
      namespaces.set(getName(exported), { local: getName(local), node: imported });
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
 * @param {string} code
 * @param {{ start: number; end: number; text: string }[]} edits
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

/**
 * Rewrites imports of generated namespaces to `import * as`, then drops the namespaces.
 * @param {import('tsdown').Rolldown.OutputChunk[]} chunks
 */
async function inlineNamespaces(chunks) {
  const parsed = await Promise.all(
    chunks.map(async (chunk) => ({ chunk, body: await parseChunk(chunk) })),
  );
  const namespacesByFile = new Map(
    parsed.map(({ chunk, body }) => [jsFileName(chunk.fileName), getNamespaces(body)]),
  );

  for (const { chunk, body } of parsed) {
    /** @type {{ start: number; end: number; text: string }[]} */
    const edits = [];
    for (const node of body) {
      if (
        (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration') ||
        !node.source?.value.startsWith('.')
      ) {
        continue;
      }
      const target = path.posix.join(path.posix.dirname(chunk.fileName), node.source.value);
      const namespaces = namespacesByFile.get(target);
      if (!namespaces?.size) {
        continue;
      }
      const source = JSON.stringify(node.source.value);
      const typeOnly =
        node.type === 'ImportDeclaration' && node.importKind === 'type' ? 'type ' : '';
      const keyword = node.type === 'ImportDeclaration' ? 'import' : 'export';
      /** @type {string[]} */
      const rest = [];
      /** @type {string[]} */
      const statements = [];
      /** @type {string | undefined} */
      let defaultImport;
      let rewritten = false;
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          defaultImport = specifier.local.name;
          continue;
        }
        if (specifier.type === 'ImportNamespaceSpecifier') {
          statements.push(`import ${typeOnly}* as ${specifier.local.name} from ${source};`);
          continue;
        }
        const [imported, alias] = getBinding(specifier);
        if (!imported || !alias || !namespaces.has(getName(imported))) {
          rest.push(slice(chunk.code, specifier));
          continue;
        }
        rewritten = true;
        // Rolldown also imports namespaces it doesn't use.
        if (keyword === 'import' && countReferences(chunk.code, getName(alias)) === 1) {
          continue;
        }
        statements.push(`${keyword} ${typeOnly}* as ${getName(alias)} from ${source};`);
      }
      if (!rewritten) {
        continue;
      }
      const clauses = [defaultImport, rest.length > 0 ? `{ ${rest.join(', ')} }` : undefined];
      if (defaultImport || rest.length > 0) {
        statements.unshift(
          `${keyword} ${typeOnly}${clauses.filter(Boolean).join(', ')} from ${source};`,
        );
      }
      edits.push({
        start: node.start,
        end: node.end,
        text: statements.join('\n'),
      });
    }
    chunk.code = applyEdits(chunk.code, edits);
  }

  const rewritten = await Promise.all(
    chunks.map(async (chunk) => ({ chunk, body: await parseChunk(chunk) })),
  );
  for (const { chunk, body } of rewritten) {
    const exports = body.flatMap((node) =>
      node.type === 'ExportNamedDeclaration' && !node.source && !node.declaration
        ? node.specifiers.map((specifier) => getBinding(specifier)[0])
        : [],
    );
    // A namespace the module uses itself is referenced beyond its declaration and exports.
    const unused = [...getNamespaces(body)].filter(([, { local }]) => {
      const exported = exports.filter((binding) => binding && getName(binding) === local).length;
      return countReferences(chunk.code, local) === 1 + exported;
    });
    if (unused.length === 0) {
      continue;
    }
    const names = new Set(unused.map(([name]) => name));
    /** @type {{ start: number; end: number; text: string }[]} */
    const edits = unused.map(([, { node }]) => ({
      start: node.start,
      end: node.end,
      text: '',
    }));
    for (const node of body) {
      if (node.type !== 'ExportNamedDeclaration' || node.source || node.declaration) {
        continue;
      }
      const kept = node.specifiers.filter((specifier) => {
        const [, exported] = getBinding(specifier);
        return !exported || !names.has(getName(exported));
      });
      if (kept.length === node.specifiers.length) {
        continue;
      }
      edits.push({
        start: node.start,
        end: node.end,
        text:
          kept.length === 0
            ? 'export {};'
            : `export { ${kept.map((specifier) => slice(chunk.code, specifier)).join(', ')} };`,
      });
    }
    chunk.code = applyEdits(chunk.code, edits);
  }
}

/**
 * @param {Node} specifier
 * @returns {[Name, Name] | []}
 */
function getBinding(specifier) {
  if (specifier.type === 'ImportSpecifier') {
    return [specifier.imported, specifier.local];
  }
  if (specifier.type === 'ExportSpecifier') {
    return [specifier.local, specifier.exported];
  }
  return [];
}

/** @param {Name} node */
function getName(node) {
  return node.type === 'Identifier' ? node.name : String(node.value);
}

/**
 * @param {string} source
 * @param {Node} node
 */
function slice(source, node) {
  return source.slice(node.start, node.end);
}

/**
 * `models/index.d.mts` → `models/index.mjs`, the path declarations import it by.
 * @param {string} fileName
 */
function jsFileName(fileName) {
  return fileName.replace(/\.d\.([cm]?)ts$/, '.$1js');
}

/**
 * For a namespace import, rolldown-plugin-dts declares a `<name>_exports` namespace that leaves out
 * names re-exported from packages. Importers get `import * as` instead, as tsc emits, and the
 * namespace is dropped. Remove this plugin once rolldown-plugin-dts keeps those names.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function dtsNamespacesPlugin() {
  return {
    name: 'code-infra:dts-namespaces',
    async generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        /** @returns {output is import('tsdown').Rolldown.OutputChunk} */
        (output) => output.type === 'chunk' && DTS_FILES.test(output.fileName),
      );
      await inlineNamespaces(chunks);
    },
  };
}
