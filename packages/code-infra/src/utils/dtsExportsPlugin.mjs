import { parseSync } from '@babel/core';
import * as fs from 'node:fs/promises';

const DTS_FILES = /\.d\.[cm]?ts$/;

const EXPORT_LISTS = new Set(['ExportAllDeclaration', 'TSExportAssignment']);

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
 * TypeScript exports every top-level declaration of a `.d.ts` module that has no export list,
 * export-all or export assignment. rolldown-plugin-dts appends `export {};`, which turns that off,
 * so hand-written declarations are made explicit before it reads them.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function dtsExportsPlugin() {
  return {
    name: 'code-infra:dts-exports',
    load: {
      order: 'pre',
      filter: { id: { include: DTS_FILES, exclude: /node_modules/ } },
      async handler(id) {
        // rolldown-plugin-dts also loads ids for declarations it generates; those aren't on disk.
        const code = await fs.readFile(id, 'utf8').catch(() => null);
        if (code === null) {
          return null;
        }
        const ast = parseSync(code, {
          filename: id,
          configFile: false,
          babelrc: false,
          parserOpts: { plugins: [['typescript', { dts: true }]] },
        });
        const body = ast?.program.body ?? [];
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
  };
}
