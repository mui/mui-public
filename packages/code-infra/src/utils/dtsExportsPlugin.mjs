import { parseSync } from '@babel/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DTS_FILES = /\.d\.[cm]?ts$/;

const GENERATED_NAMESPACE = /_exports$/;

const EXPORT_LISTS = new Set(['ExportAllDeclaration', 'TSExportAssignment']);

const MODULE_SYNTAX = new Set([
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'TSExportAssignment',
]);

const DECLARATIONS = new Set([
  'ClassDeclaration',
  'FunctionDeclaration',
  'TSDeclareFunction',
  'TSEnumDeclaration',
  'TSInterfaceDeclaration',
  'TSModuleDeclaration',
  'TSTypeAliasDeclaration',
  'VariableDeclaration',
]);

/**
 * @param {string} id
 * @returns {Promise<{ code: string; body: import('@babel/core').types.Statement[] } | null>}
 */
async function parseDts(id) {
  // rolldown-plugin-dts also loads ids for declarations it generates; those aren't on disk.
  const code = await fs.readFile(id, 'utf8').catch(() => null);
  if (code === null) {
    return null;
  }
  return { code, body: parse(code, id) };
}

/**
 * @param {string} code
 * @param {string} filename
 */
function parse(code, filename) {
  const ast = parseSync(code, {
    filename,
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: [['typescript', { dts: true }]] },
  });
  return ast?.program.body ?? [];
}

/**
 * The `<name>_exports` namespaces Rolldown declares for a module's namespace object.
 * @param {import('@babel/core').types.Statement[]} body
 */
function getNamespaces(body) {
  /** @type {Map<string, import('@babel/core').types.Node>} */
  const namespaces = new Map();
  for (const node of body) {
    if (
      node.type !== 'TSModuleDeclaration' ||
      !node.declare ||
      node.id.type !== 'Identifier' ||
      !GENERATED_NAMESPACE.test(node.id.name) ||
      node.body?.type !== 'TSModuleBlock' ||
      !node.body.body.every((child) => child.type === 'ExportNamedDeclaration' && !child.source)
    ) {
      continue;
    }
    namespaces.set(node.id.name, node);
  }
  return namespaces;
}

/**
 * @param {string} code
 * @param {{ start: number; end: number; text: string }[]} edits
 */
function applyEdits(code, edits) {
  let result = code;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return result;
}

/**
 * Rewrites imports of generated namespaces to `import * as`, then drops the namespaces.
 * @param {import('tsdown').Rolldown.OutputChunk[]} chunks
 */
function inlineNamespaces(chunks) {
  const parsed = chunks.map((chunk) => ({ chunk, body: parse(chunk.code, chunk.fileName) }));
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
      for (const specifier of node.specifiers) {
        const [imported, alias] = getBinding(specifier);
        if (!imported || !alias || !namespaces.has(getName(imported))) {
          rest.push(slice(chunk.code, specifier));
          continue;
        }
        statements.push(`${keyword} ${typeOnly}* as ${getName(alias)} from ${source};`);
      }
      if (statements.length === 0) {
        continue;
      }
      if (rest.length > 0) {
        statements.unshift(`${keyword} ${typeOnly}{ ${rest.join(', ')} } from ${source};`);
      }
      edits.push({
        start: /** @type {number} */ (node.start),
        end: /** @type {number} */ (node.end),
        text: statements.join('\n'),
      });
    }
    chunk.code = applyEdits(chunk.code, edits);
  }

  for (const { chunk } of parsed) {
    const body = parse(chunk.code, chunk.fileName);
    // A namespace the module uses itself is referenced beyond its declaration and export.
    const unused = [...getNamespaces(body)].filter(
      ([name]) => chunk.code.match(new RegExp(`\\b${name}\\b`, 'g'))?.length === 2,
    );
    if (unused.length === 0) {
      continue;
    }
    const names = new Set(unused.map(([name]) => name));
    /** @type {{ start: number; end: number; text: string }[]} */
    const edits = unused.map(([, declaration]) => ({
      start: /** @type {number} */ (declaration.start),
      end: /** @type {number} */ (declaration.end),
      text: '',
    }));
    for (const node of body) {
      if (node.type !== 'ExportNamedDeclaration' || node.source || node.declaration) {
        continue;
      }
      const kept = node.specifiers.filter(
        (specifier) =>
          !(specifier.type === 'ExportSpecifier' && names.has(getName(specifier.local))),
      );
      if (kept.length === node.specifiers.length) {
        continue;
      }
      edits.push({
        start: /** @type {number} */ (node.start),
        end: /** @type {number} */ (node.end),
        text: `export { ${kept.map((specifier) => slice(chunk.code, specifier)).join(', ')} };`,
      });
    }
    chunk.code = applyEdits(chunk.code, edits);
  }
}

/**
 * @param {import('@babel/core').types.Node} specifier
 * @returns {[import('@babel/core').types.Identifier | import('@babel/core').types.StringLiteral, import('@babel/core').types.Identifier | import('@babel/core').types.StringLiteral] | []}
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

/** @param {import('@babel/core').types.Identifier | import('@babel/core').types.StringLiteral} node */
function getName(node) {
  return node.type === 'Identifier' ? node.name : node.value;
}

/**
 * @param {string} source
 * @param {import('@babel/core').types.Node} node
 */
function slice(source, node) {
  return source.slice(/** @type {number} */ (node.start), /** @type {number} */ (node.end));
}

/**
 * `models/index.d.mts` → `models/index.mjs`, the path declarations import it by.
 * @param {string} fileName
 */
function jsFileName(fileName) {
  return fileName.replace(/\.d\.([cm]?)ts$/, '.$1js');
}

/** @param {import('@babel/core').types.Statement[]} body */
function isScript(body) {
  return !body.some(
    (node) =>
      MODULE_SYNTAX.has(node.type) ||
      (node.type === 'TSImportEqualsDeclaration' &&
        node.moduleReference.type === 'TSExternalModuleReference'),
  );
}

/**
 * TypeScript exports every top-level declaration of a `.d.ts` module that has no export list,
 * export-all or export assignment. rolldown-plugin-dts appends `export {};`, which turns that off,
 * so hand-written declarations are made explicit before it reads them.
 *
 * A `.d.ts` without imports or exports declares globals, which bundling would make local. Imports
 * of one stay external and the file is copied unchanged, as `code-infra build` does.
 *
 * For a namespace import, rolldown-plugin-dts declares a `<name>_exports` namespace that leaves out
 * names re-exported from packages. Importers get `import * as` instead, as tsc emits.
 * @param {string} root The source directory output paths are relative to.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function dtsExportsPlugin(root) {
  return {
    name: 'code-infra:dts-exports',
    resolveId: {
      order: 'pre',
      async handler(source, importer, options) {
        if (!importer || !DTS_FILES.test(importer)) {
          return null;
        }
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!resolved || !DTS_FILES.test(resolved.id) || resolved.id.includes('node_modules')) {
          return null;
        }
        const parsed = await parseDts(resolved.id);
        if (!parsed || !isScript(parsed.body)) {
          return null;
        }
        this.emitFile({
          type: 'asset',
          fileName: path.relative(root, resolved.id),
          source: parsed.code,
        });
        return { id: source, external: true };
      },
    },
    load: {
      order: 'pre',
      filter: { id: { include: DTS_FILES, exclude: /node_modules/ } },
      async handler(id) {
        const parsed = await parseDts(id);
        if (!parsed) {
          return null;
        }
        const { code, body } = parsed;
        const hasExportList = body.some(
          (node) =>
            EXPORT_LISTS.has(node.type) ||
            (node.type === 'ExportNamedDeclaration' && !node.declaration) ||
            // `export default value;` is an export assignment to TypeScript; `export default
            // function f() {}` is a declaration.
            (node.type === 'ExportDefaultDeclaration' && !DECLARATIONS.has(node.declaration.type)),
        );
        if (hasExportList) {
          return null;
        }

        const starts = body
          .filter(
            (node) =>
              DECLARATIONS.has(node.type) &&
              !(
                node.type === 'TSModuleDeclaration' &&
                (node.kind === 'global' || node.id.type === 'StringLiteral')
              ),
          )
          .map((node) => /** @type {number} */ (node.start));
        if (starts.length === 0) {
          return null;
        }

        let result = code;
        for (const start of starts.reverse()) {
          result = `${result.slice(0, start)}export ${result.slice(start)}`;
        }
        return result;
      },
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        /** @returns {output is import('tsdown').Rolldown.OutputChunk} */
        (output) => output.type === 'chunk' && DTS_FILES.test(output.fileName),
      );
      inlineNamespaces(chunks);
    },
  };
}
