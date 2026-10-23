import ts from 'typescript';
import { EnumMember, EnumNode, ExportNode, TypeName } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { formatPropertyComment } from './formatType';
import { isComponentType, isEnumType } from './typeGuards';

/** Which of a component's tables a constant group holds. */
export type ConstantGroupKind = 'dataAttributes' | 'cssVariables';

/**
 * A constant group is a named set of constant values an entrypoint publishes, either as an
 * enum or as a namespace of constants (`export * as ButtonDataAttributes from './…'`); both
 * are represented as an enum-shaped export. Its name tells which component table it holds:
 * the component's name with its dots removed, followed by one of these suffixes, e.g.
 * `ToolbarButtonDataAttributes` holds the data attributes of `Toolbar.Button`.
 */
const KIND_SUFFIXES: Record<ConstantGroupKind, string> = {
  dataAttributes: 'DataAttributes',
  cssVariables: 'CssVariables',
};

export interface ConstantGroupTarget {
  /** The component's name as the entrypoint exports it, e.g. `Toolbar.Button` */
  component: string;
  kind: ConstantGroupKind;
}

/** The constant groups holding one component's tables. */
export type ComponentConstantGroups = Partial<Record<ConstantGroupKind, tae.EnumNode>>;

function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  // eslint-disable-next-line no-bitwise -- TypeScript symbol flags are a bitmask
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/** The value of a constant in a constant group. */
type ConstantValue = string | number;

/**
 * Reads the value of a `const` holding a string or number literal.
 */
function readLiteralConstant(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ConstantValue | undefined {
  const declaration = symbol.valueDeclaration;
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    // eslint-disable-next-line no-bitwise -- TypeScript node flags are a bitmask
    !(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)
  ) {
    return undefined;
  }

  const type = checker.getTypeOfSymbol(symbol);
  return type.isStringLiteral() || type.isNumberLiteral() ? type.value : undefined;
}

/**
 * Reads a module's exports as constant values, when it exports nothing but literal constants.
 */
function readConstantModule(
  moduleSymbol: ts.Symbol,
  checker: ts.TypeChecker,
): Map<string, ConstantValue> | undefined {
  const values = new Map<string, ConstantValue>();
  const members = checker.getExportsOfModule(moduleSymbol);
  const isConstantModule =
    members.length > 0 &&
    members.every((member) => {
      const value = readLiteralConstant(resolveAlias(member, checker), checker);
      if (value === undefined) {
        return false;
      }
      values.set(member.name, value);
      return true;
    });

  return isConstantModule ? values : undefined;
}

/**
 * Finds the entrypoint's namespace exports whose module holds nothing but literal constants,
 * e.g. `export * as ButtonDataAttributes from './ButtonDataAttributes'`, with their values.
 * Namespaces nested in other namespace exports are found too, under their dotted path
 * (`Toolbar.ButtonDataAttributes`).
 *
 * The parser flattens such a namespace into one export per member and cannot tell a constant
 * from a type alias of the same literal, so the checker is asked instead.
 *
 * @returns Member values keyed by namespace path, then member name
 */
export function findConstantNamespaces(
  entrypoint: string,
  program: ts.Program,
): Map<string, Map<string, ConstantValue>> {
  const namespaces = new Map<string, Map<string, ConstantValue>>();
  const sourceFile = program.getSourceFile(entrypoint);
  const checker = program.getTypeChecker();
  const entrypointSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  const visited = new Set<ts.Symbol>();

  const visit = (moduleSymbol: ts.Symbol, prefix: string) => {
    for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
      if (exportSymbol.declarations?.some(ts.isNamespaceExport)) {
        const target = checker.getAliasedSymbol(exportSymbol);
        const path = `${prefix}${exportSymbol.name}`;
        const values = readConstantModule(target, checker);

        if (values) {
          namespaces.set(path, values);
        } else if (!visited.has(target)) {
          visited.add(target);
          visit(target, `${path}.`);
        }
      }
    }
  };

  if (entrypointSymbol) {
    visit(entrypointSymbol, '');
  }

  return namespaces;
}

/**
 * Collapses the flattened members of each constant namespace (`ButtonDataAttributes.open`)
 * into a single enum-shaped export named after the namespace, in place of its first member.
 */
export function foldConstantNamespaces(
  exports: tae.ExportNode[],
  namespaces: Map<string, Map<string, ConstantValue>>,
): tae.ExportNode[] {
  if (namespaces.size === 0) {
    return exports;
  }

  const groups = new Map<string, EnumMember[]>();
  const folded: tae.ExportNode[] = [];

  for (const node of exports) {
    // Members sit directly under their namespace, which may itself be nested
    // (`Toolbar.ButtonDataAttributes.pressed`).
    const dot = node.name.lastIndexOf('.');
    const namespace = dot === -1 ? undefined : node.name.slice(0, dot);
    const memberName = node.name.slice(dot + 1);
    const value = namespace === undefined ? undefined : namespaces.get(namespace)?.get(memberName);

    if (namespace === undefined || value === undefined) {
      folded.push(node);
    } else {
      let members = groups.get(namespace);
      if (!members) {
        members = [];
        groups.set(namespace, members);
        folded.push(
          new ExportNode(
            namespace,
            new EnumNode(new TypeName(namespace), members, undefined),
            undefined,
          ),
        );
      }
      // Typed as a string, but the parser stores numeric enum values as numbers too; do
      // the same so both forms render alike.
      members.push(new EnumMember(memberName, value as string, node.documentation));
    }
  }

  return folded;
}

/**
 * Writes the declaration of a constant group as it is exported: a namespace of constants
 * for a namespace export, an enum otherwise.
 */
export function formatConstantGroupDeclaration(
  name: string,
  group: tae.EnumNode,
  asNamespace: boolean,
): string {
  const members = group.members.map((member) => {
    // Enum members hold the literal's value, numbers included; a computed member has none.
    const value: unknown = member.value;
    const literal = typeof value === 'number' ? String(value) : JSON.stringify(value);
    const comment = member.documentation ? formatPropertyComment(member.documentation) : undefined;
    let declaration = `${member.name} = ${literal},`;
    if (asNamespace) {
      declaration = `const ${member.name}: ${literal};`;
    } else if (value === undefined) {
      declaration = `${member.name},`;
    }
    return comment ? `${comment}\n${declaration}` : declaration;
  });

  return asNamespace
    ? `declare namespace ${name} {\n${members.join('\n')}\n}`
    : `enum ${name} {\n${members.join('\n')}\n}`;
}

/**
 * Resolves which component each constant group documents from its name: the component's
 * name with its dots removed, followed by `DataAttributes` or `CssVariables`.
 *
 * Throws when the name before the suffix is not exactly one of the exported components.
 *
 * @returns Targets keyed by the group's export name, and each component's groups
 */
export function matchConstantGroups(exports: tae.ExportNode[]): {
  targets: Map<string, ConstantGroupTarget>;
  byComponent: Map<string, ComponentConstantGroups>;
} {
  const targets = new Map<string, ConstantGroupTarget>();
  const byComponent = new Map<string, ComponentConstantGroups>();

  const componentsByFlatName = new Map<string, string[]>();
  for (const node of exports) {
    if (isComponentType(node.type)) {
      const flatName = node.name.replaceAll('.', '');
      const names = componentsByFlatName.get(flatName);
      if (names) {
        names.push(node.name);
      } else {
        componentsByFlatName.set(flatName, [node.name]);
      }
    }
  }

  const kinds = Object.keys(KIND_SUFFIXES) as ConstantGroupKind[];

  for (const node of exports) {
    // Names are compared without dots, like the component names they stand for, so a group
    // exported inside a namespace (`Toolbar.ButtonDataAttributes`) matches too.
    const groupName = node.name.replaceAll('.', '');
    const kind = kinds.find(
      (candidate) =>
        groupName.endsWith(KIND_SUFFIXES[candidate]) &&
        groupName.length > KIND_SUFFIXES[candidate].length,
    );

    if (kind && isEnumType(node.type)) {
      const flatName = groupName.slice(0, -KIND_SUFFIXES[kind].length);
      const components = componentsByFlatName.get(flatName) ?? [];
      if (components.length !== 1) {
        throw new Error(
          components.length === 0
            ? `[constantGroups] ${node.name} - no exported component is named ${flatName}`
            : `[constantGroups] ${node.name} - ${components.join(', ')} are all named ${flatName}`,
        );
      }

      const [component] = components;
      targets.set(node.name, { component, kind });

      const groups = byComponent.get(component) ?? {};
      groups[kind] ??= node.type;
      byComponent.set(component, groups);
    }
  }

  return { targets, byComponent };
}
