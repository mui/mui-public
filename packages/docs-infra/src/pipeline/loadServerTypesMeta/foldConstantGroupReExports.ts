import ts from 'typescript';
import { ExportNode } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { isEnumType } from './typeGuards';

/**
 * A constant group published as a namespace under its own name, e.g.
 * `export * as ToggleDataAttributes from './ButtonDataAttributes'`.
 */
export type ConstantGroupReExport = tae.ExportNode & {
  /**
   * Name of the group derived from the module it came from (`ButtonDataAttributes`),
   * which is how components find their data attributes and CSS variables.
   */
  constantGroupSource: string;
};

export function isConstantGroupReExport(node: tae.ExportNode): node is ConstantGroupReExport {
  return typeof (node as Partial<ConstantGroupReExport>).constantGroupSource === 'string';
}

/**
 * Whether a symbol is a `const` holding a string or number literal.
 */
function isLiteralConstant(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  const declaration = symbol.valueDeclaration;
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    // eslint-disable-next-line no-bitwise -- TypeScript node flags are a bitmask
    !(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)
  ) {
    return false;
  }

  const type = checker.getTypeOfSymbol(symbol);
  return type.isStringLiteral() || type.isNumberLiteral();
}

/**
 * Finds the entrypoint's namespace re-exports of modules holding nothing but literal
 * constants, e.g. `export * as ButtonDataAttributes from './ButtonDataAttributes'`.
 *
 * The parser flattens such a namespace into one export per member (`ButtonDataAttributes.open`)
 * and keeps no record of the module behind it, so the checker is asked instead. It also tells
 * a constant apart from a type alias of the same literal, which the parsed nodes cannot.
 *
 * @returns A map of public namespace name to the module it re-exports
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

    const targetModule = checker.getAliasedSymbol(exportSymbol);
    const target = targetModule.declarations?.find((declaration) => ts.isSourceFile(declaration));
    const members = checker.getExportsOfModule(targetModule).map((member) =>
      // eslint-disable-next-line no-bitwise -- TypeScript symbol flags are a bitmask
      member.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(member) : member,
    );

    if (
      target &&
      members.length > 0 &&
      members.every((member) => isLiteralConstant(member, checker))
    ) {
      reExports.set(exportSymbol.name, target.fileName);
    }
  }

  return reExports;
}

/**
 * Replaces the flattened members of each namespace re-exported constant module with the
 * module's constant group, published under the namespace's name.
 *
 * The group takes the position of the namespace's first member. A module that does not
 * read as a constant group leaves its members as they were.
 *
 * @param exports - The entrypoint's exports as parsed
 * @param reExports - Public namespace names mapped to the modules behind them
 * @param loadGroup - Returns a module's constant group, when it reads as one
 */
export function foldConstantGroupReExports(
  exports: tae.ExportNode[],
  reExports: Map<string, string>,
  loadGroup: (filePath: string) => tae.ExportNode | undefined,
): tae.ExportNode[] {
  if (reExports.size === 0) {
    return exports;
  }

  const groups = new Map<string, ConstantGroupReExport>();
  for (const [publicName, filePath] of reExports) {
    const group = loadGroup(filePath);
    if (group && isEnumType(group.type)) {
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
