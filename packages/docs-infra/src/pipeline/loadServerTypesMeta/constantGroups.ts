import { EnumMember, EnumNode, ExportNode, TypeName } from '@mui/internal-typescript-api-extractor';
import type * as tae from '@mui/internal-typescript-api-extractor';
import { formatPropertyComment } from './formatType';
import { isComponentType, isEnumType, isLiteralType } from './typeGuards';

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

/** The value of a constant in a constant group. */
type ConstantValue = string | number;

/**
 * Reads the value of an export holding a string or number literal. The parser quotes
 * string literals and keeps numbers as they are.
 */
function readLiteralValue(node: tae.ExportNode | undefined): ConstantValue | undefined {
  if (!node || !isLiteralType(node.type)) {
    return undefined;
  }

  const value: unknown = node.type.value;
  if (typeof value === 'number') {
    return value;
  }

  return typeof value === 'string' &&
    value.length >= 2 &&
    value.startsWith('"') &&
    value.endsWith('"')
    ? value.slice(1, -1)
    : undefined;
}

/**
 * Reads a namespace re-export as a group of constants, when every runtime export of its
 * module is a literal constant. Type-only exports, such as a union of the constants or a
 * namespace of types, are typing helpers and do not count. Any other runtime export,
 * including one the parser emits no export for and a namespace holding values, means the
 * module is more than constants. Constants are recognized by their literal type, so a
 * `let` reads as one only when it is annotated with a literal type rather than widened.
 *
 * @param valueExports The parsed runtime exports, keyed by name
 * @returns The group's members, or nothing when the namespace is not a group of constants
 */
function readConstantNamespace(
  namespace: tae.NamespaceReexport,
  valueExports: Map<string, tae.ExportNode>,
): EnumMember[] | undefined {
  // Through a type-only site, no member is a value, so nothing is folded.
  const members: EnumMember[] = [];
  for (const member of namespace.members) {
    if (member.isValue) {
      if (member.isNamespace) {
        return undefined;
      }

      const node = valueExports.get(`${namespace.name}.${member.name}`);
      const value = readLiteralValue(node);
      if (value === undefined) {
        return undefined;
      }

      members.push(new EnumMember(member.name, value, node?.documentation));
    }
  }

  return members.length > 0 ? members : undefined;
}

/**
 * Collapses the constants of each namespace re-export holding nothing at runtime but
 * literal constants (`ButtonDataAttributes.open`) into a single enum-shaped export named
 * after the namespace, in place of its first constant. Namespaces nested in other
 * namespace re-exports are folded under their dotted path (`Toolbar.ButtonDataAttributes`).
 * Type-only exports of such a namespace stay as they are.
 *
 * @returns The exports with constant namespaces folded, and the folded namespaces' names
 */
export function foldConstantNamespaces(
  parsedModule: Pick<tae.ModuleNode, 'exports' | 'namespaceReexports'>,
): {
  exports: tae.ExportNode[];
  namespaces: string[];
} {
  const { exports, namespaceReexports = [] } = parsedModule;

  const valueExports = new Map<string, tae.ExportNode>();
  for (const node of exports) {
    if (node.isValue) {
      valueExports.set(node.name, node);
    }
  }

  // The folded group of each constant, keyed by the constant's export name.
  const groupsByConstant = new Map<string, tae.ExportNode>();
  const namespaces: string[] = [];
  for (const namespace of namespaceReexports) {
    const members = readConstantNamespace(namespace, valueExports);
    if (members) {
      namespaces.push(namespace.name);
      const group = new ExportNode(
        namespace.name,
        new EnumNode(new TypeName(namespace.name), members, undefined),
        undefined,
        // `export * as X` binds a module namespace object.
        { isValue: true, isType: false, isNamespace: true },
      );
      for (const member of members) {
        groupsByConstant.set(`${namespace.name}.${member.name}`, group);
      }
    }
  }

  if (namespaces.length === 0) {
    return { exports, namespaces };
  }

  const placed = new Set<tae.ExportNode>();
  const folded: tae.ExportNode[] = [];
  for (const node of exports) {
    const group = node.isValue ? groupsByConstant.get(node.name) : undefined;
    if (!group) {
      folded.push(node);
    } else if (!placed.has(group)) {
      placed.add(group);
      folded.push(group);
    }
  }

  return { exports: folded, namespaces };
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
    // A computed enum member has no value.
    const { value } = member;
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
