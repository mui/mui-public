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
 * @param {string} code
 * @param {Body} body
 */
function reexportImports(code, body) {
  /** @type {Map<string, { name: string; source: string; typeOnly: boolean }>} */
  const imports = new Map();

  for (const node of body) {
    if (node.type !== 'ImportDeclaration') {
      continue;
    }

    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') {
        continue;
      }

      imports.set(specifier.local.name, {
        name:
          specifier.type === 'ImportDefaultSpecifier'
            ? 'default'
            : code.slice(specifier.imported.start, specifier.imported.end),
        source: code.slice(node.source.start, node.source.end),
        typeOnly:
          node.importKind === 'type' ||
          (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type'),
      });
    }
  }

  const result = new RolldownMagicString(code);

  for (const node of body) {
    if (node.type !== 'ExportNamedDeclaration' || node.source || node.declaration) {
      continue;
    }

    const kept = [];
    const statements = [];

    for (const specifier of node.specifiers) {
      const imported = specifier.local.type === 'Identifier' && imports.get(specifier.local.name);

      if (!imported) {
        kept.push(code.slice(specifier.start, specifier.end));
        continue;
      }

      const exported = code.slice(specifier.exported.start, specifier.exported.end);
      const binding = imported.name === exported ? exported : `${imported.name} as ${exported}`;

      const typeOnly =
        imported.typeOnly || node.exportKind === 'type' || specifier.exportKind === 'type';

      statements.push(`export ${typeOnly ? 'type ' : ''}{ ${binding} } from ${imported.source};`);
    }

    if (statements.length === 0) {
      continue;
    }

    if (kept.length > 0) {
      statements.push(`export ${node.exportKind === 'type' ? 'type ' : ''}{ ${kept.join(', ')} };`);
    }

    result.update(node.start, node.end, statements.join('\n'));
  }

  return result.toString();
}

/**
 * TypeScript exports every top-level declaration of a `.d.ts` module that has no export list,
 * export-all or export assignment. rolldown-plugin-dts appends `export {};`, which turns that off,
 * so hand-written declarations are made explicit before it reads them. Writing `export` on them in
 * the source avoids the rewrite; `@mui/material`'s `Popover/Popover.d.ts` is the only file that
 * relies on it.
 *
 * A `.d.ts` without imports or exports declares globals, which bundling would make local. Imports
 * of one stay external and the file is copied unchanged with the declarations it references.
 * @param {string} root The source directory output paths are relative to.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function dtsExportsPlugin(root) {
  return {
    name: 'code-infra:dts-exports',
    async generateBundle(_options, bundle) {
      // Exporting an imported alias can merge augmentations into the alias instead of its target.
      await Promise.all(
        Object.values(bundle).map(async (chunk) => {
          if (chunk.type !== 'chunk' || !DTS_FILES.test(chunk.fileName)) {
            return;
          }

          const { program } = await parse(chunk.fileName, chunk.code, { lang: 'dts' });

          chunk.code = reexportImports(chunk.code, program.body);
        }),
      );
    },
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
