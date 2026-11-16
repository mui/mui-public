import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RolldownMagicString } from 'rolldown';
import { parse } from 'rolldown/utils';

const DTS_FILES = /\.d\.[cm]?ts$/;

const REFERENCE_PATH = /^\/\s*<reference\s+path\s*=\s*(["'])(.+?)\1/;

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

/** @typedef {import('rolldown/utils').ParseResult['program']['body']} Body */
/** @typedef {import('rolldown/utils').ParseResult['comments']} Comments */

/**
 * @param {string} id
 * @returns {Promise<{ code: string; body: Body; comments: Comments } | null>}
 */
async function parseDts(id) {
  // rolldown-plugin-dts also loads ids for declarations it generates; those aren't on disk.
  const code = await fs.readFile(id, 'utf8').catch(() => null);
  if (code === null) {
    return null;
  }
  const { program, comments } = await parse(id, code, { lang: 'dts' });
  return { code, body: program.body, comments };
}

/**
 * Copies a declaration and, recursively, the local declarations it references.
 * @param {import('tsdown').Rolldown.PluginContext} ctx
 * @param {string} root
 * @param {string} id
 * @param {{ code: string; comments: Comments }} parsed
 * @param {Set<string>} seen
 */
async function copyDts(ctx, root, id, parsed, seen) {
  seen.add(id);
  ctx.emitFile({ type: 'asset', fileName: path.relative(root, id), source: parsed.code });

  for (const comment of parsed.comments) {
    const match = comment.type === 'Line' ? REFERENCE_PATH.exec(comment.value) : null;
    if (!match) {
      continue;
    }
    const target = path.resolve(path.dirname(id), match[2]);
    if (seen.has(target) || target.includes('node_modules')) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const nested = await parseDts(target);
    if (!nested) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await copyDts(ctx, root, target, nested, seen);
  }
}

/** @param {Body} body */
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
 * of one stay external and the file is copied unchanged with the declarations it references, as
 * `code-infra build` does.
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
        await copyDts(this, root, resolved.id, parsed, new Set());
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

        const declarations = body.filter(
          (node) =>
            DECLARATIONS.has(node.type) &&
            !(
              node.type === 'TSModuleDeclaration' &&
              (node.kind === 'global' || node.id.type === 'Literal')
            ),
        );
        if (declarations.length === 0) {
          return null;
        }

        const result = new RolldownMagicString(code);
        for (const node of declarations) {
          result.prependRight(node.start, 'export ');
        }
        return result.toString();
      },
    },
  };
}
