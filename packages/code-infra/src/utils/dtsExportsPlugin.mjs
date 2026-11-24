import { RolldownMagicString } from 'rolldown';
import { parse } from 'rolldown/utils';

import { DTS_FILES } from './rolldownOutput.mjs';

/** @typedef {import('rolldown/utils').ParseResult['program']['body']} Body */

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
 * rolldown-plugin-dts prints re-exports as `import { X } from …; export { X }`. Module
 * augmentation of the exported alias then doesn't reach the interface other declarations
 * reference, so these become `export { X } from …`.
 * @returns {import('tsdown').Rolldown.Plugin}
 */
export function dtsExportsPlugin() {
  return {
    name: 'code-infra:dts-exports',
    async generateBundle(_options, bundle) {
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
  };
}
