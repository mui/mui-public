import ts from 'typescript';
import { EnumMember, EnumNode, ExportNode, TypeName } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { formatPropertyComment } from './formatType';
import { isComponentType, isEnumType } from './typeGuards';

/**
 * Export name patterns marking which constant groups hold a component's table.
 *
 * A constant group is a named set of constant values an entrypoint publishes, either as an
 * enum or as a namespace of constants (`export * as ButtonDataAttributes from './…'`); both
 * are represented as an enum-shaped export. In each pattern, the `*` stands for the
 * component's name with its dots removed, e.g. with `'*DataAttributes'` the group
 * `ToolbarButtonDataAttributes` holds the data attributes of `Toolbar.Button`.
 *
 * A type alias rather than an interface, so it stays assignable to the JSON-valued loader
 * options bundlers expect.
 */
export type ConstantGroupPatterns = {
  dataAttributes?: string;
  cssVariables?: string;
};

/** Which of a component's tables a constant group holds. */
export type ConstantGroupKind = keyof ConstantGroupPatterns;

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

/**
 * Reads the value of a `const` holding a string or number literal, as the bare string an
 * enum member would carry.
 */
function readLiteralConstant(symbol: ts.Symbol, checker: ts.TypeChecker): string | undefined {
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
  return type.isStringLiteral() || type.isNumberLiteral() ? String(type.value) : undefined;
}

/**
 * Finds the entrypoint's namespace exports whose module holds nothing but literal constants,
 * e.g. `export * as ButtonDataAttributes from './ButtonDataAttributes'`, with their values.
 *
 * The parser flattens such a namespace into one export per member and cannot tell a constant
 * from a type alias of the same literal, so the checker is asked instead.
 *
 * @returns Member values keyed by namespace name, then member name
 */
export function findConstantNamespaces(
  entrypoint: string,
  program: ts.Program,
): Map<string, Map<string, string>> {
  const namespaces = new Map<string, Map<string, string>>();
  const sourceFile = program.getSourceFile(entrypoint);
  const checker = program.getTypeChecker();
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    return namespaces;
  }

  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    if (exportSymbol.declarations?.some(ts.isNamespaceExport)) {
      const values = new Map<string, string>();
      const members = checker.getExportsOfModule(checker.getAliasedSymbol(exportSymbol));
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

      if (isConstantModule) {
        namespaces.set(exportSymbol.name, values);
      }
    }
  }

  return namespaces;
}

/**
 * Collapses the flattened members of each constant namespace (`ButtonDataAttributes.open`)
 * into a single enum-shaped export named after the namespace, in place of its first member.
 */
export function foldConstantNamespaces(
  exports: tae.ExportNode[],
  namespaces: Map<string, Map<string, string>>,
): tae.ExportNode[] {
  if (namespaces.size === 0) {
    return exports;
  }

  const groups = new Map<string, EnumMember[]>();
  const folded: tae.ExportNode[] = [];

  for (const node of exports) {
    const dot = node.name.indexOf('.');
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
      members.push(new EnumMember(memberName, value, node.documentation));
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
    const value = typeof member.value === 'number' ? member.value : JSON.stringify(member.value);
    const comment = member.documentation ? formatPropertyComment(member.documentation) : undefined;
    const declaration = asNamespace
      ? `const ${member.name}: ${value};`
      : `${member.name} = ${value},`;
    return comment ? `${comment}\n${declaration}` : declaration;
  });

  return asNamespace
    ? `declare namespace ${name} {\n${members.join('\n')}\n}`
    : `enum ${name} {\n${members.join('\n')}\n}`;
}

/**
 * Resolves which component each constant group documents, by matching group names against
 * the configured patterns.
 *
 * Throws when a pattern is malformed, when a group matches several patterns, or when the
 * name a pattern captures is not exactly one of the exported components.
 *
 * @returns Targets keyed by the group's export name, and each component's groups
 */
export function matchConstantGroups(
  exports: tae.ExportNode[],
  patterns: ConstantGroupPatterns = {},
): {
  targets: Map<string, ConstantGroupTarget>;
  byComponent: Map<string, ComponentConstantGroups>;
} {
  const targets = new Map<string, ConstantGroupTarget>();
  const byComponent = new Map<string, ComponentConstantGroups>();

  const matchers = (Object.keys(patterns) as ConstantGroupKind[]).flatMap((kind) => {
    const pattern = patterns[kind];
    if (pattern === undefined) {
      return [];
    }

    const parts = pattern.split('*');
    if (parts.length !== 2) {
      throw new Error(
        `[constantGroups] ${kind} pattern "${pattern}" must contain exactly one \`*\``,
      );
    }

    const [prefix, suffix] = parts;
    return [{ prefix, suffix, kind }];
  });

  if (matchers.length === 0) {
    return { targets, byComponent };
  }

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

        const [component] = components;
        targets.set(node.name, { component, kind: match.kind });

        const groups = byComponent.get(component) ?? {};
        groups[match.kind] ??= node.type;
        byComponent.set(component, groups);
      }
    }
  }

  return { targets, byComponent };
}
