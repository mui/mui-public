import ts from 'typescript';
import { EnumMember, EnumNode, ExportNode, TypeName } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { isLiteralType } from './typeGuards';

/**
 * A constant group is a named set of constant values an entrypoint publishes, either as an
 * enum or as a namespace of constants (`export * as ButtonDataAttributes from './…'`).
 * Both are represented as an enum-shaped export.
 */
export type ConstantGroupKind = 'data-attributes' | 'css-variables';

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

function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  // eslint-disable-next-line no-bitwise -- TypeScript symbol flags are a bitmask
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * Finds the entrypoint's namespace exports whose module holds nothing but literal constants,
 * e.g. `export * as ButtonDataAttributes from './ButtonDataAttributes'`.
 *
 * The parser flattens such a namespace into one export per member and cannot tell a constant
 * from a type alias of the same literal, so the checker is asked instead.
 */
export function findConstantNamespaces(entrypoint: string, program: ts.Program): Set<string> {
  const namespaces = new Set<string>();
  const sourceFile = program.getSourceFile(entrypoint);
  const checker = program.getTypeChecker();
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    return namespaces;
  }

  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    if (exportSymbol.declarations?.some(ts.isNamespaceExport)) {
      const members = checker
        .getExportsOfModule(checker.getAliasedSymbol(exportSymbol))
        .map((member) => resolveAlias(member, checker));

      if (members.length > 0 && members.every((member) => isLiteralConstant(member, checker))) {
        namespaces.add(exportSymbol.name);
      }
    }
  }

  return namespaces;
}

/**
 * Reads a constant's value from its literal type. String literals arrive wrapped in quotes
 * (`"data-open"`) while numeric literals do not; both become the bare string an enum member
 * would carry.
 */
function readLiteralValue(type: tae.AnyType): string | undefined {
  if (!isLiteralType(type)) {
    return undefined;
  }

  const { value } = type;
  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string' && value.length >= 2 && value.startsWith('"')) {
    return value.slice(1, -1);
  }

  return undefined;
}

/**
 * Collapses the flattened members of each constant namespace (`ButtonDataAttributes.open`)
 * into a single enum-shaped export named after the namespace, in place of its first member.
 */
export function foldConstantNamespaces(
  exports: tae.ExportNode[],
  namespaces: Set<string>,
): tae.ExportNode[] {
  if (namespaces.size === 0) {
    return exports;
  }

  const members = new Map<string, EnumMember[]>();
  const folded: tae.ExportNode[] = [];

  for (const node of exports) {
    const dot = node.name.indexOf('.');
    const namespace = node.name.slice(0, dot);
    const value = dot === -1 ? undefined : readLiteralValue(node.type);

    if (value === undefined || !namespaces.has(namespace)) {
      folded.push(node);
    } else {
      if (!members.has(namespace)) {
        members.set(namespace, []);
        folded.push(
          new ExportNode(
            namespace,
            new EnumNode(new TypeName(namespace), members.get(namespace)!, undefined),
            undefined,
          ),
        );
      }
      members
        .get(namespace)!
        .push(new EnumMember(node.name.slice(dot + 1), value, node.documentation));
    }
  }

  return folded;
}

/**
 * Tells what a constant group holds from its values: data attributes (`data-open`) or
 * CSS variables (`--width`). Groups of anything else are not component metadata.
 */
export function getConstantGroupKind(
  values: Array<string | number | undefined>,
): ConstantGroupKind | undefined {
  if (values.length === 0) {
    return undefined;
  }
  if (values.every((value) => typeof value === 'string' && value.startsWith('data-'))) {
    return 'data-attributes';
  }
  if (values.every((value) => typeof value === 'string' && value.startsWith('--'))) {
    return 'css-variables';
  }
  return undefined;
}

/**
 * Finds the component a constant group belongs to: the one with the longest name the group's
 * name starts with, ignoring dots. `AlertDialogPopupDataAttributes` belongs to
 * `AlertDialog.Popup` rather than `AlertDialog`.
 *
 * @returns The owning component's name as given, or `undefined`
 */
export function findConstantGroupOwner(
  groupName: string,
  componentNames: string[],
): string | undefined {
  const flatGroupName = groupName.replace(/\./g, '');
  let owner: string | undefined;
  let ownerLength = 0;

  for (const componentName of componentNames) {
    const flatName = componentName.replace(/\./g, '');
    if (
      flatName.length > ownerLength &&
      flatName.length < flatGroupName.length &&
      flatGroupName.startsWith(flatName)
    ) {
      owner = componentName;
      ownerLength = flatName.length;
    }
  }

  return owner;
}
