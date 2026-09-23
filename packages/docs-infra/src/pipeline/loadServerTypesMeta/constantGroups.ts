import ts from 'typescript';
import { EnumMember, EnumNode, ExportNode, TypeName } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import { isComponentType, isEnumType, isLiteralType } from './typeGuards';

/**
 * A constant group is a named set of constant values an entrypoint publishes, either as an
 * enum or as a namespace of constants (`export * as ButtonDataAttributes from './…'`).
 * Both are represented as an enum-shaped export.
 *
 * A group documents a component's data attributes or CSS variables when its export is
 * tagged `@docs-enum dataAttributes <Component>` or `@docs-enum cssVariables <Component>`.
 */
export type ConstantGroupKind = 'data-attributes' | 'css-variables';

export interface ConstantGroupTarget {
  /** The component's name as the entrypoint exports it, e.g. `Toolbar.Button` */
  component: string;
  kind: ConstantGroupKind;
}

export interface ConstantGroupExports {
  /** Namespace exports of modules holding nothing but literal constants */
  namespaces: Set<string>;
  /** Tagged exports, keyed by public name */
  targets: Map<string, ConstantGroupTarget>;
}

const DOCS_ENUM_TAG = 'docs-enum';

/** The kinds a `@docs-enum` tag accepts, keyed as they are written in the tag. */
const KINDS: Record<string, ConstantGroupKind> = {
  dataAttributes: 'data-attributes',
  cssVariables: 'css-variables',
};

type AttachedConstantGroup = tae.ExportNode & { constantGroupTarget: ConstantGroupTarget };

/**
 * Returns the component a constant group documents, when its export is tagged with one.
 */
export function getConstantGroupTarget(node: tae.ExportNode): ConstantGroupTarget | undefined {
  return (node as Partial<AttachedConstantGroup>).constantGroupTarget;
}

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
 * Reads a `@docs-enum <kind> <Component>` tag from the statement declaring an export.
 */
function readTarget(name: string, declaration: ts.Declaration): ConstantGroupTarget | undefined {
  // JSDoc sits on the whole `export … from` statement rather than on its clauses.
  let statement: ts.Node = declaration;
  if (ts.isNamespaceExport(declaration)) {
    statement = declaration.parent;
  } else if (ts.isExportSpecifier(declaration)) {
    statement = declaration.parent.parent;
  }

  const tags = ts.getJSDocTags(statement).filter((tag) => tag.tagName.text === DOCS_ENUM_TAG);
  if (tags.length === 0) {
    return undefined;
  }

  const [kindName = '', component, ...rest] = (ts.getTextOfJSDocComment(tags[0].comment) ?? '')
    .trim()
    .split(/\s+/);
  const kind = Object.hasOwn(KINDS, kindName) ? KINDS[kindName] : undefined;

  if (tags.length > 1 || !kind || !component || rest.length > 0) {
    throw new Error(
      `[constantGroups] ${name} - expected a single \`@${DOCS_ENUM_TAG} <kind> <Component>\` with kind one of ${Object.keys(KINDS).join(', ')}`,
    );
  }

  return { component, kind };
}

/**
 * Finds the entrypoint's constant namespaces and the component each tagged export documents.
 *
 * The parser flattens a namespace export into one export per member and cannot tell a
 * constant from a type alias of the same literal, nor does it keep JSDoc written on an
 * `export … from` statement, so the checker is asked instead.
 */
export function findConstantGroupExports(
  entrypoint: string,
  program: ts.Program,
): ConstantGroupExports {
  const found: ConstantGroupExports = { namespaces: new Set(), targets: new Map() };
  const sourceFile = program.getSourceFile(entrypoint);
  const checker = program.getTypeChecker();
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    return found;
  }

  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = exportSymbol.name;
    const [declaration] = exportSymbol.declarations ?? [];
    const target = declaration && readTarget(name, declaration);
    if (target) {
      found.targets.set(name, target);
    }

    if (declaration && ts.isNamespaceExport(declaration)) {
      const members = checker
        .getExportsOfModule(checker.getAliasedSymbol(exportSymbol))
        .map((member) => resolveAlias(member, checker));

      if (members.length > 0 && members.every((member) => isLiteralConstant(member, checker))) {
        found.namespaces.add(name);
      }
    }
  }

  return found;
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
 * into a single enum-shaped export named after the namespace, in place of its first member,
 * and attaches each tagged group to the component it documents.
 *
 * Throws when a tag sits on an export that is not a constant group, or names a component
 * the entrypoint does not export.
 */
export function foldConstantGroups(
  exports: tae.ExportNode[],
  found: ConstantGroupExports,
): tae.ExportNode[] {
  const members = new Map<string, EnumMember[]>();
  const folded: tae.ExportNode[] = [];

  for (const node of exports) {
    const dot = node.name.indexOf('.');
    const namespace = node.name.slice(0, dot);
    const value = dot === -1 ? undefined : readLiteralValue(node.type);

    if (value === undefined || !found.namespaces.has(namespace)) {
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

  if (found.targets.size === 0) {
    return folded;
  }

  const components = new Set(
    folded.filter((node) => isComponentType(node.type)).map((node) => node.name),
  );
  const unattached = new Map(found.targets);

  const attached = folded.map((node) => {
    const target = found.targets.get(node.name);
    if (!target || !isEnumType(node.type)) {
      return node;
    }
    if (!components.has(target.component)) {
      throw new Error(
        `[constantGroups] ${node.name} - tagged for ${target.component}, which this entrypoint does not export as a component`,
      );
    }

    unattached.delete(node.name);
    return Object.assign(new ExportNode(node.name, node.type, node.documentation), {
      constantGroupTarget: target,
    });
  });

  if (unattached.size > 0) {
    throw new Error(
      `[constantGroups] ${Array.from(unattached.keys()).join(', ')} - tagged as component metadata, but not an enum or a namespace of constants`,
    );
  }

  return attached;
}
