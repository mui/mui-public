import { TypeName } from '@mui/internal-typescript-api-extractor';
import type * as tae from '@mui/internal-typescript-api-extractor';

/**
 * Documents each declaration once, under one name: of the exports sharing a `declarationId`,
 * keeps the one to document (the canonical export) and treats the others as its aliases, then
 * names every type reference to a declaration the page exports by that declaration's canonical
 * export.
 *
 * An alias reaches the same declaration as its canonical export, whether it spells the name
 * differently (`DialogTrigger` from `export type *` next to `Dialog.Trigger`), renames it
 * (`compressString` for `compressHast`), or is a plain rename (`type State = DialogTriggerState`),
 * so documenting it would describe one API twice. A reference carries the id of the declaration
 * it names, so it is named the way the page documents that declaration whatever name it is
 * written with. Only the references are renamed, so descriptions keep the names their authors
 * wrote.
 *
 * @returns The exports to document, and each alias's name mapped to its canonical export's name
 */
export function resolveExportAliases(exports: tae.ExportNode[]): {
  exports: tae.ExportNode[];
  aliases: Map<string, string>;
} {
  const groups = new Map<string, tae.ExportNode[]>();
  for (const node of exports) {
    if (node.declarationId !== undefined) {
      groups.set(node.declarationId, [...(groups.get(node.declarationId) ?? []), node]);
    }
  }

  const aliases = new Map<string, string>();
  const canonicalNames = new Map<string, string>();
  for (const [declarationId, group] of groups) {
    const canonical = selectCanonicalExport(group);
    canonicalNames.set(declarationId, canonical.name);
    // Only an interface export records what it extends; a rename of it documented in its
    // place extends the same types.
    canonical.extendsTypes ??= group.find((node) => node.extendsTypes)?.extendsTypes;
    for (const node of group) {
      // The extractor can emit one name twice, such as a namespace declared in two blocks;
      // both copies are the canonical export.
      if (node.name !== canonical.name) {
        aliases.set(node.name, canonical.name);
      }
    }
  }

  const canonicalExports = exports.filter((node) => !aliases.has(node.name));
  const visited = new WeakSet<object>();
  for (const node of canonicalExports) {
    nameReferences(node.type, canonicalNames, visited);
  }

  return { exports: canonicalExports, aliases };
}

/**
 * Picks the export to document a shared declaration under, by the first rule that
 * tells two exports apart:
 *
 * 1. a value export over a type-only one, since only it carries the runtime binding;
 * 2. the export nested under more namespaces, which is the public path a
 *    namespaced API documents, whether it re-exports the declaration under its own
 *    name (`Dialog.Trigger` for `DialogTrigger`) or renames it
 *    (`Field.ValidityData` for `FieldValidityData`);
 * 3. the export named like the declaration, by its own name (its last segment) or by its
 *    whole name read without the dots (`Menu.Root.ChangeEventReason` for
 *    `MenuRootChangeEventReason`), over a rename such as `default`, `compressString` for
 *    `compressHast`, or `Menu.CheckboxItem.ChangeEventReason`;
 * 4. the export emitted first.
 */
function selectCanonicalExport(group: tae.ExportNode[]): tae.ExportNode {
  const rank = (node: tae.ExportNode): number[] => [
    node.isValue ? 1 : 0,
    node.name.split('.').length,
    node.name.slice(node.name.lastIndexOf('.') + 1) === node.declaredName ||
    node.name.replaceAll('.', '') === node.declaredName
      ? 1
      : 0,
  ];

  return group.reduce((best, node) => {
    const nodeRank = rank(node);
    const bestRank = rank(best);
    const index = nodeRank.findIndex((value, position) => value !== bestRank[position]);
    return index !== -1 && nodeRank[index] > bestRank[index] ? node : best;
  });
}

/**
 * Replaces, in place, every `TypeName` under `value` that names a declaration the page exports
 * with a `TypeName` of that declaration's canonical export, keeping its type arguments.
 * Documentation is skipped: it holds no type references, and its JSDoc nodes link back into the
 * TypeScript syntax tree.
 */
function nameReferences(
  value: unknown,
  canonicalNames: Map<string, string>,
  visited: WeakSet<object>,
): void {
  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return;
  }
  visited.add(value);

  for (const key of Object.keys(value)) {
    if (key === 'documentation') {
      continue;
    }
    const child: unknown = Reflect.get(value, key);
    if (child instanceof TypeName) {
      const canonicalName =
        child.declarationId === undefined ? undefined : canonicalNames.get(child.declarationId);
      if (
        canonicalName !== undefined &&
        canonicalName !== [...(child.namespaces ?? []), child.name].join('.')
      ) {
        const segments = canonicalName.split('.');
        const name = segments.pop()!;
        Reflect.set(
          value,
          key,
          new TypeName(
            name,
            segments.length > 0 ? segments : undefined,
            child.typeArguments,
            child.declarationId,
          ),
        );
      }
    }
    nameReferences(Reflect.get(value, key), canonicalNames, visited);
  }
}
