import * as path from 'node:path';
import { RolldownMagicString } from 'rolldown';
import { parse, Visitor } from 'rolldown/utils';

const DTS_FILES = /\.d\.[cm]?ts$/;

const GENERATED_NAMESPACE = /_exports$/;
const RUNTIME_MODULE = '\0rolldown/runtime.js';

/**
 * @typedef {{ start: number; end: number; text: string }} Edit
 * @typedef {import('rolldown/utils').ESTree.Node} Node
 * @typedef {import('rolldown/utils').ESTree.ModuleExportName | import('rolldown/utils').ESTree.BindingIdentifier} Name
 * @typedef {import('rolldown/utils').ESTree.ImportDeclarationSpecifier | import('rolldown/utils').ESTree.ExportSpecifier} Specifier
 * @typedef {'es' | 'cjs'} Format
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
async function parseProgram(chunk) {
  const { program } = await parse(chunk.fileName, chunk.code, { lang: 'js' });

  return program;
}

/** @param {import('tsdown').Rolldown.OutputChunk} chunk */
async function parseChunk(chunk) {
  return (await parseProgram(chunk)).body;
}

/**
 * The chunk `node` loads when it is `require('./file')`.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 * @param {Node | null | undefined} node
 */
function getRequired(chunk, node) {
  const source = node?.type === 'CallExpression' ? node.arguments[0] : null;

  if (
    node?.type !== 'CallExpression' ||
    node.callee.type !== 'Identifier' ||
    node.callee.name !== 'require' ||
    source?.type !== 'Literal' ||
    typeof source.value !== 'string' ||
    !source.value.startsWith('.')
  ) {
    return undefined;
  }

  return path.posix.join(path.posix.dirname(chunk.fileName), source.value);
}

/**
 * The CommonJS reads of other chunks' exports, ie, `require_parts.name` and
 * `require('./parts.js').name`.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 */
async function getRequiredReads(chunk) {
  const program = await parseProgram(chunk);
  /** @type {Map<string, string>} */
  const bindings = new Map();

  for (const node of program.body) {
    for (const declarator of node.type === 'VariableDeclaration' ? node.declarations : []) {
      const target = getRequired(chunk, declarator.init);

      if (target && declarator.id.type === 'Identifier') {
        bindings.set(declarator.id.name, target);
      }
    }
  }

  /** @type {Set<string>} */
  const required = new Set();
  /** @type {{ node: import('rolldown/utils').ESTree.MemberExpression; target: string; name: string }[]} */
  const reads = [];
  new Visitor({
    CallExpression(node) {
      const target = getRequired(chunk, node);

      if (target) {
        required.add(target);
      }
    },
    MemberExpression(node) {
      const { object, property } = node;

      const target =
        object.type === 'Identifier' ? bindings.get(object.name) : getRequired(chunk, object);

      if (target && !node.computed && property.type === 'Identifier') {
        reads.push({ node, target, name: property.name });
      }
    },
  }).visit(program);

  return { required, reads };
}

/**
 * Whether `node` calls Rolldown's runtime `helper`, imported (ESM) or read off its `require()` (CJS).
 * @param {Node | null | undefined} node
 * @param {string} helper
 */
function callsHelper(node, helper) {
  if (node?.type !== 'CallExpression') {
    return false;
  }

  const { callee } = node;

  if (callee.type === 'Identifier') {
    return callee.name === helper;
  }

  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === helper
  );
}

/**
 * The name `statement` exports as CommonJS through a getter returning `local`, ie,
 * `Object.defineProperty(exports, "name", { get() { return local; } })`.
 * @param {Node} statement
 * @param {string} local
 */
function getCjsExport(statement, local) {
  const call = statement.type === 'ExpressionStatement' ? statement.expression : null;

  if (
    call?.type !== 'CallExpression' ||
    call.callee.type !== 'MemberExpression' ||
    call.callee.object.type !== 'Identifier' ||
    call.callee.object.name !== 'Object' ||
    call.callee.property.type !== 'Identifier' ||
    call.callee.property.name !== 'defineProperty' ||
    call.arguments[0]?.type !== 'Identifier' ||
    call.arguments[0].name !== 'exports' ||
    call.arguments[1]?.type !== 'Literal' ||
    call.arguments[2]?.type !== 'ObjectExpression'
  ) {
    return undefined;
  }

  const getter = call.arguments[2].properties.find(
    (property) =>
      property.type === 'Property' &&
      property.key.type === 'Identifier' &&
      property.key.name === 'get',
  );

  const body =
    getter?.type === 'Property' && getter.value.type === 'FunctionExpression'
      ? getter.value.body?.body
      : null;

  const returned =
    body?.length === 1 && body[0].type === 'ReturnStatement' ? body[0].argument : null;

  return returned?.type === 'Identifier' && returned.name === local
    ? String(call.arguments[1].value)
    : undefined;
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
      callsHelper(statement.expression, '__reExport') &&
      statement.expression.type === 'CallExpression' &&
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

  const cjsExports = body.filter((statement) => getCjsExport(statement, name) !== undefined);

  const cjsReferences = cjsExports.reduce(
    (count, statement) => count + countReferences(slice(chunk, statement), name),
    0,
  );

  const usedLocally =
    countReferences(chunk.code, name) !== 1 + reExports.length + exports.length + cjsReferences;

  return { reExports, cjsExports, usedLocally };
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
      !callsHelper(init, '__exportAll') ||
      init?.type !== 'CallExpression' ||
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
  const requiredReads = await Promise.all(chunks.map(getRequiredReads));
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

    const { required, reads } = requiredReads[index];

    for (const target of required) {
      imported.set(target, imported.get(target) ?? new Set());
    }

    for (const { target, name } of reads) {
      imported.get(target)?.add(name);
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
      !callsHelper(declarator.init, '__exportAll') ||
      imported.has(declarator.id.name)
    ) {
      continue;
    }
    const name = declarator.id.name;
    const { reExports, cjsExports, usedLocally } = getOwnStatements(chunk, body, name);
    if (usedLocally) {
      continue;
    }
    dropped.add(name);
    edits.push(
      replace(node, ''),
      ...[...reExports, ...cjsExports].map((statement) => replace(statement, '')),
    );
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
 * Prints statements for the specifiers of an `import` or `export ... from`, keeping default and
 * namespace imports out of the braces.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 * @param {Specifier[]} specifiers
 * @param {'import' | 'export'} keyword
 * @param {string} source The quoted module specifier.
 * @returns {string[]}
 */
function printSpecifiers(chunk, specifiers, keyword, source) {
  /** @type {string[]} */
  const statements = [];
  /** @type {string | undefined} */
  let defaultImport;
  /** @type {string[]} */
  const named = [];
  for (const specifier of specifiers) {
    if (specifier.type === 'ImportDefaultSpecifier') {
      defaultImport = specifier.local.name;
      continue;
    }
    if (specifier.type === 'ImportNamespaceSpecifier') {
      statements.push(`import * as ${specifier.local.name} from ${source};`);
      continue;
    }
    named.push(slice(chunk, specifier));
  }

  const clauses = [defaultImport, named.length > 0 ? `{ ${named.join(', ')} }` : undefined];
  if (defaultImport || named.length > 0) {
    statements.unshift(`${keyword} ${clauses.filter(Boolean).join(', ')} from ${source};`);
  }
  return statements;
}

/**
 * Removes the imports the dropped namespaces used: runtime helpers and namespaces they re-exported.
 * @param {import('tsdown').Rolldown.OutputChunk} chunk
 */
async function dropUnusedImports(chunk) {
  /** @type {Edit[]} */
  const edits = [];
  for (const node of await parseChunk(chunk)) {
    const declarator = node.type === 'VariableDeclaration' ? node.declarations[0] : null;

    if (
      declarator?.id.type === 'Identifier' &&
      getRequired(chunk, declarator.init) &&
      countReferences(chunk.code, declarator.id.name) === 1
    ) {
      edits.push(replace(node, ''));
      continue;
    }

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
    const source = JSON.stringify(node.source.value);
    edits.push(replace(node, printSpecifiers(chunk, kept, 'import', source).join('\n')));
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

  for (const { node, target, name } of (await getRequiredReads(chunk)).reads) {
    if (rewritable.get(target)?.has(name)) {
      edits.push(replace(node, slice(chunk, node.object)));
    }
  }

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
    /** @type {Specifier[]} */
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
        rest.push(specifier);
        continue;
      }
      namespaces.push(`${keyword} * as ${printName(alias)} from ${source};`);
    }
    if (namespaces.length === 0) {
      continue;
    }
    const statements = [...printSpecifiers(chunk, rest, keyword, source), ...namespaces];
    edits.push(replace(node, statements.join('\n')));
  }
  chunk.code = applyEdits(chunk.code, edits);
}

/**
 * Deletes Rolldown's runtime helpers once the dropped namespaces were their last users.
 * @param {import('tsdown').Rolldown.OutputBundle} bundle
 * @param {import('tsdown').Rolldown.OutputChunk[]} chunks
 */
async function dropUnusedRuntime(bundle, chunks) {
  const runtime = chunks.find((chunk) => chunk.moduleIds.includes(RUNTIME_MODULE));
  if (!runtime) {
    return;
  }
  const imported = await getImportedNames(chunks);
  if (!imported.has(runtime.fileName)) {
    delete bundle[runtime.fileName];
  }
}

/**
 * Rolldown turns `export * as X from './parts'` into an `__exportAll()` object holding every
 * export, which bundlers can't tree-shake. Rolldown also reads names an external `export *` provides
 * through that object. ESM chunks import such namespaces with `import * as` instead, and CommonJS
 * chunks read the module's `exports`. Objects nothing references any more are removed with their
 * `<name>_exports` export.
 * Remove this plugin once Rolldown keeps namespace re-exports in unbundled builds:
 * https://github.com/rolldown/rolldown/issues/6669
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function jsNamespacesPlugin() {
  return {
    name: 'code-infra:js-namespaces',
    async generateBundle(options, bundle) {
      if (options.format !== 'es' && options.format !== 'cjs') {
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
      await dropUnusedRuntime(bundle, chunks);
    },
  };
}
