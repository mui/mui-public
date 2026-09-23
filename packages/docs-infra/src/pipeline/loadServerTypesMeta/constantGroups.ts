import ts from 'typescript';
import { EnumMember, EnumNode, ExportNode, TypeName } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { isComponentType, isEnumType, isLiteralType } from './typeGuards';

/**
 * A constant group is a named set of constant values an entrypoint publishes, either as an
 * enum or as a namespace of constants (`export * as ButtonDataAttributes from './…'`).
 * Both are represented as an enum-shaped export.
 */
export type ConstantGroupKind = 'data-attributes' | 'css-variables';

/**
 * Name patterns marking which constant groups document a component's table. The `*` stands
 * for the component's name with its dots removed, e.g. with `'*DataAttributes'` the group
 * `ToolbarButtonDataAttributes` holds the data attributes of `Toolbar.Button`.
 */
export interface ConstantGroupPatterns {
  dataAttributes?: string;
  cssVariables?: string;
}

export interface ConstantGroupTarget {
  /** The component's name as the entrypoint exports it, e.g. `Toolbar.Button` */
  component: string;
  kind: ConstantGroupKind;
}

const PATTERN_KINDS: Record<keyof ConstantGroupPatterns, ConstantGroupKind> = {
  dataAttributes: 'data-attributes',
  cssVariables: 'css-variables',
};

function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  // eslint-disable-next-line no-bitwise -- TypeScript symbol flags are a bitmask
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
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
 * Resolves which component each constant group documents, by matching group names against
 * the configured patterns.
 *
 * Throws when a pattern is malformed, when a group matches several patterns, or when the
 * name a pattern captures is not exactly one of the exported components.
 *
 * @returns Targets keyed by the group's export name
 */
export function matchConstantGroups(
  exports: tae.ExportNode[],
  patterns: ConstantGroupPatterns = {},
): Map<string, ConstantGroupTarget> {
  const matchers = Object.entries(patterns).flatMap(([key, pattern]) => {
    if (pattern === undefined) {
      return [];
    }

    const parts = pattern.split('*');
    if (parts.length !== 2) {
      throw new Error(
        `[constantGroups] ${key} pattern "${pattern}" must contain exactly one \`*\``,
      );
    }

    const [prefix, suffix] = parts;
    const kind = PATTERN_KINDS[key as keyof ConstantGroupPatterns];
    return [{ prefix, suffix, kind }];
  });

  const targets = new Map<string, ConstantGroupTarget>();
  if (matchers.length === 0) {
    return targets;
  }

  const componentsByFlatName = new Map<string, string[]>();
  for (const node of exports) {
    if (isComponentType(node.type)) {
      const flatName = node.name.replace(/\./g, '');
      componentsByFlatName.set(flatName, [
        ...(componentsByFlatName.get(flatName) ?? []),
        node.name,
      ]);
    }
  }

  for (const node of exports) {
    if (isEnumType(node.type)) {
      const matches = matchers.filter(
        ({ prefix, suffix }) =>
          node.name.length > prefix.length + suffix.length &&
          node.name.startsWith(prefix) &&
          node.name.endsWith(suffix),
      );

      if (matches.length > 1) {
        throw new Error(`[constantGroups] ${node.name} matches more than one pattern`);
      }

      const [match] = matches;
      if (match) {
        const flatName = node.name.slice(
          match.prefix.length,
          node.name.length - match.suffix.length,
        );
        const components = componentsByFlatName.get(flatName) ?? [];
        if (components.length !== 1) {
          throw new Error(
            components.length === 0
              ? `[constantGroups] ${node.name} - no exported component is named ${flatName}`
              : `[constantGroups] ${node.name} - ${components.join(', ')} are all named ${flatName}`,
          );
        }

        targets.set(node.name, { component: components[0], kind: match.kind });
      }
    }
  }

  return targets;
}
