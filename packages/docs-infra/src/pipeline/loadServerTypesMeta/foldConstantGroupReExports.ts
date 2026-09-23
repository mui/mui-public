import ts from 'typescript';
import { ExportNode } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { isMetaFile } from './findMetaFiles';
import { isEnumType } from './typeGuards';

/**
 * A constant group published under its own name, e.g.
 * `export * as ToggleDataAttributes from './ButtonDataAttributes'`.
 */
export type ConstantGroupReExport = tae.ExportNode & {
  /**
   * Name of the group derived from the metadata file it came from (`ButtonDataAttributes`),
   * which is how components find their data attributes and CSS variables.
   */
  constantGroupSource: string;
};

export function isConstantGroupReExport(node: tae.ExportNode): node is ConstantGroupReExport {
  return typeof (node as Partial<ConstantGroupReExport>).constantGroupSource === 'string';
}

/**
 * Finds the entrypoint's namespace re-exports of metadata files, e.g.
 * `export * as ButtonDataAttributes from './ButtonDataAttributes'`.
 *
 * The parser flattens such a namespace into one export per member (`ButtonDataAttributes.open`)
 * and keeps no record of the module behind it, so the checker is asked instead.
 *
 * @returns A map of public namespace name to the metadata file it re-exports
 */
export function findConstantGroupReExports(
  entrypoint: string,
  program: ts.Program,
): Map<string, string> {
  const reExports = new Map<string, string>();
  const sourceFile = program.getSourceFile(entrypoint);
  const checker = program.getTypeChecker();
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    return reExports;
  }

  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    if (!exportSymbol.declarations?.some(ts.isNamespaceExport)) {
      continue;
    }

    const target = checker
      .getAliasedSymbol(exportSymbol)
      .declarations?.find((declaration) => ts.isSourceFile(declaration));

    if (target && isMetaFile(target.fileName)) {
      reExports.set(exportSymbol.name, target.fileName);
    }
  }

  return reExports;
}

/**
 * Replaces the flattened members of each namespace re-exported metadata file with the
 * file's constant group, published under the namespace's name.
 *
 * The group takes the position of the namespace's first member. A metadata file that does
 * not normalize to a constant group leaves its members as they were.
 *
 * @param exports - The entrypoint's exports as parsed
 * @param reExports - Public namespace names mapped to the metadata files behind them
 * @param loadGroup - Returns a metadata file's exports normalized by `transformConstantGroup`
 */
export function foldConstantGroupReExports(
  exports: tae.ExportNode[],
  reExports: Map<string, string>,
  loadGroup: (filePath: string) => tae.ExportNode[],
): tae.ExportNode[] {
  if (reExports.size === 0) {
    return exports;
  }

  const groups = new Map<string, ConstantGroupReExport>();
  for (const [publicName, filePath] of reExports) {
    const fileExports = loadGroup(filePath);
    const [group] = fileExports;
    if (fileExports.length === 1 && isEnumType(group.type)) {
      groups.set(
        publicName,
        Object.assign(new ExportNode(publicName, group.type, group.documentation), {
          constantGroupSource: group.name,
        }),
      );
    }
  }

  const folded: tae.ExportNode[] = [];
  const emitted = new Set<string>();
  for (const node of exports) {
    const dot = node.name.indexOf('.');
    const namespace = dot === -1 ? undefined : node.name.slice(0, dot);
    const group = namespace === undefined ? undefined : groups.get(namespace);

    if (!group) {
      folded.push(node);
    } else if (!emitted.has(group.name)) {
      emitted.add(group.name);
      folded.push(group);
    }
  }

  return folded;
}
