import { TypeName } from '@mui/internal-typescript-api-extractor';
import type * as tae from '@mui/internal-typescript-api-extractor';

/**
 * Documents each declaration once: of the exports sharing a `declarationId`, keeps the
 * one to document (the canonical export) and treats the others as its aliases, then
 * points type references to an alias at the canonical name.
 *
 * An alias reaches the same declaration as its canonical export, whether it spells
 * the name differently (`DialogTrigger` from `export type *` next to `Dialog.Trigger`)
 * or renames it (`compressString` for `compressHast`), so documenting it would describe
 * one API twice. A type reference whose whole name is an alias is replaced with one to
 * the canonical export. Only the references are rewritten, so descriptions keep the
 * names their authors wrote.
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
  for (const group of groups.values()) {
    const canonical = selectCanonicalExport(group);
    for (const node of group) {
      if (node !== canonical) {
        aliases.set(node.name, canonical.name);
      }
    }
  }

  const canonicalExports = exports.filter((node) => !aliases.has(node.name));
  if (aliases.size > 0) {
    for (const node of canonicalExports) {
      replaceAliasReferences(node.type, aliases);
    }
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
 * 3. the export whose own name (its last segment) is the declaration's name, over
 *    a rename such as `default` or `compressString` for `compressHast`;
 * 4. the export emitted first.
 */
function selectCanonicalExport(group: tae.ExportNode[]): tae.ExportNode {
  const declaredName = getDeclaredName(group);
  const rank = (node: tae.ExportNode): number[] => [
    node.isValue ? 1 : 0,
    node.name.split('.').length,
    node.name.slice(node.name.lastIndexOf('.') + 1) === declaredName ? 1 : 0,
  ];

  return group.reduce((best, node) => {
    const nodeRank = rank(node);
    const bestRank = rank(best);
    const index = nodeRank.findIndex((value, position) => value !== bestRank[position]);
    return index !== -1 && nodeRank[index] > bestRank[index] ? node : best;
  });
}

/**
 * The name a group's declaration is written with, read from the group itself: a flat
 * export's type keeps the declaration's name (`formatValue` for `export { formatValue as
 * format }`), and a renamed re-export records the name it re-exports. Exports nested in a
 * namespace take the namespace's name for their type instead, so they cannot tell.
 */
function getDeclaredName(group: tae.ExportNode[]): string | undefined {
  for (const node of group) {
    const typeName = 'typeName' in node.type ? node.type.typeName : undefined;
    if (!node.name.includes('.') && typeName?.name) {
      return typeName.name;
    }
  }
  return group.find((node) => node.reexportedFrom !== undefined)?.reexportedFrom;
}

/**
 * Replaces, in place, every `TypeName` under `value` whose full name is an alias with a
 * `TypeName` of the canonical name, keeping its type arguments.
 */
function replaceAliasReferences(
  value: unknown,
  aliases: Map<string, string>,
  visited = new WeakSet<object>(),
): void {
  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return;
  }
  visited.add(value);

  for (const key of Object.keys(value)) {
    const child: unknown = Reflect.get(value, key);
    if (child instanceof TypeName) {
      const canonicalName = aliases.get([...(child.namespaces ?? []), child.name].join('.'));
      if (canonicalName !== undefined) {
        const segments = canonicalName.split('.');
        const name = segments.pop()!;
        Reflect.set(
          value,
          key,
          new TypeName(name, segments.length > 0 ? segments : undefined, child.typeArguments),
        );
      }
    }
    replaceAliasReferences(Reflect.get(value, key), aliases, visited);
  }
}
