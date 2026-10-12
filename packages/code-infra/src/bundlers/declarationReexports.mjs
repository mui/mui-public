import MagicString from 'magic-string';
import { parse } from 'yuku-parser';

/**
 * Keep declaration barrels as direct re-exports. Documentation extractors need
 * the original exported symbol rather than an intermediate import binding.
 */
export function declarationReexports() {
  return {
    name: 'mui-declaration-reexports',
    /**
     * @param {string} code
     * @param {{ fileName: string }} chunk
     */
    renderChunk(code, chunk) {
      if (!/\.d\.[cm]?ts$/.test(chunk.fileName)) {
        return null;
      }
      const { program } = parse(code, { lang: 'dts', sourceType: 'module' });
      if (
        program.body.some(
          (node) =>
            node.type !== 'ImportDeclaration' &&
            node.type !== 'ExportAllDeclaration' &&
            (node.type !== 'ExportNamedDeclaration' || node.declaration),
        )
      ) {
        return null;
      }
      /** @type {Map<string, { source: string; imported: string; namespace: boolean }>} */
      const imports = new Map();
      for (const node of program.body) {
        if (node.type !== 'ImportDeclaration') {
          continue;
        }
        for (const specifier of node.specifiers) {
          let imported = 'default';
          if (specifier.type === 'ImportSpecifier') {
            imported =
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.imported.value;
          }
          imports.set(specifier.local.name, {
            source: node.source.value,
            imported,
            namespace: specifier.type === 'ImportNamespaceSpecifier',
          });
        }
      }
      const output = new MagicString(code);
      const forwarded = new Set();
      for (const node of program.body) {
        if (node.type !== 'ExportNamedDeclaration' || node.source) {
          continue;
        }
        const statements = [];
        for (const specifier of node.specifiers) {
          const local =
            specifier.local.type === 'Identifier' ? specifier.local.name : specifier.local.value;
          const imported = imports.get(local);
          // Leave the whole barrel intact if it also exports a local binding.
          if (!imported) {
            return null;
          }
          forwarded.add(local);
          const exported = code.slice(specifier.exported.start, specifier.exported.end);
          const type = node.exportKind === 'type' || specifier.exportKind === 'type' ? 'type ' : '';
          statements.push(
            imported.namespace
              ? `export ${type}* as ${exported} from ${JSON.stringify(imported.source)};`
              : `export ${type}{ ${JSON.stringify(imported.imported)} as ${exported} } from ${JSON.stringify(imported.source)};`,
          );
        }
        output.overwrite(node.start, node.end, statements.join('\n'));
      }
      for (const node of program.body) {
        if (
          node.type === 'ImportDeclaration' &&
          node.specifiers.length &&
          node.specifiers.every((specifier) => forwarded.has(specifier.local.name))
        ) {
          output.remove(node.start, node.end);
        }
      }
      return forwarded.size
        ? { code: output.toString(), map: output.generateMap({ hires: true }) }
        : null;
    },
  };
}
