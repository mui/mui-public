import { uniq } from 'es-toolkit';
import type * as tae from '@mui/internal-typescript-api-extractor';
import {
  isExternalType,
  isIntrinsicType,
  isUnionType,
  isObjectType,
  isLiteralType,
  isTemplateLiteralType,
  isTypeOperatorType,
  isTypeQueryType,
  isArrayType,
} from './typeGuards';
import { isBuiltInTypeName } from './builtInTypes';
import { groupType, UNION_OR_INTERSECTION } from './precedence';
import { formatTemplateLiteral } from './templateLiteral';

/**
 * Metadata for an external type discovered during formatting.
 * These are types referenced in props/params that are not publicly exported,
 * but whose definitions may be useful for documentation (e.g., union types).
 */
export interface ExternalTypeMeta {
  /** The type name (e.g., "Orientation") */
  name: string;
  /** The type definition as a string (e.g., "'horizontal' | 'vertical'") */
  definition: string;
}

/**
 * Collector for external types discovered during formatting.
 * Pass this to formatType/formatProperties/formatParameters to collect
 * external types as they are encountered in the formatted output.
 */
export interface ExternalTypesCollector {
  /** Map to accumulate results (type name -> ExternalTypeMeta) */
  collected: Map<string, ExternalTypeMeta>;
  /**
   * Where the external types in the formatted output are declared, keyed by the name they are
   * printed as. `null` marks a name printed for types from different declarations.
   */
  sources: Map<string, tae.ExternalTypeSource | null>;
  /** All exports in the module, used to identify own types */
  allExports: tae.ExportNode[];
  /** Optional pattern to filter which external types to include */
  pattern?: RegExp;
  /** Map of original export names to dotted display names, used to identify renamed own types */
  typeNameMap?: Record<string, string>;
}

function withoutTypeArguments(printedName: string): string {
  const typeArgumentsStart = printedName.indexOf('<');
  return typeArgumentsStart === -1 ? printedName : printedName.slice(0, typeArgumentsStart);
}

/**
 * Records where an external type printed as `printedName` is declared, so the name can be
 * linked to that declaration's docs. A name printed for two different declarations, such as
 * the DOM `Range` and a package's `Range`, cannot tell them apart and is marked ambiguous.
 */
export function collectExternalTypeSource(
  printedName: string,
  source: tae.ExternalTypeSource | undefined,
  collector: ExternalTypesCollector,
): void {
  if (!source) {
    return;
  }
  const name = withoutTypeArguments(printedName);
  const existing = collector.sources.get(name);
  if (existing === undefined) {
    collector.sources.set(name, source);
  } else if (existing !== null && JSON.stringify(existing) !== JSON.stringify(source)) {
    collector.sources.set(name, null);
  }
}

/**
 * Records that a project's own type is printed as `printedName`. The occurrences of a name
 * cannot be told apart, so an external type printed the same way is left unlinked too.
 */
export function collectOwnTypeName(printedName: string, collector: ExternalTypesCollector): void {
  collector.sources.set(withoutTypeArguments(printedName), null);
}

/**
 * The source of a union named after the one external type it adds `undefined` or `null` to,
 * as the extractor names optional props of an external type: `Intl.NumberFormat | undefined`
 * keeps the name `Intl.NumberFormat`. An alias of its own, such as
 * `type MaybeElement = HTMLElement | null`, is not that type and has no source.
 */
export function getNamedUnionSource(type: tae.UnionNode): tae.ExternalTypeSource | undefined {
  const members = type.types.filter(
    (member) =>
      !(
        isIntrinsicType(member) &&
        (member.intrinsic === 'undefined' || member.intrinsic === 'null')
      ),
  );
  const [member] = members;
  if (members.length !== 1 || !isExternalType(member) || !type.typeName) {
    return undefined;
  }
  const sameName =
    member.typeName.name === type.typeName.name &&
    (member.typeName.namespaces ?? []).join('.') === (type.typeName.namespaces ?? []).join('.');
  return sameName ? member.source : undefined;
}

/**
 * Checks whether a type name belongs to one of the module's own exports.
 * Matches both direct export names (e.g., `AlertDialogRootChangeEventReason`)
 * and short names that appear as the last segment of a typeNameMap value
 * (e.g., `ChangeEventReason` matching `AlertDialog.Root.ChangeEventReason`).
 */
export function isOwnTypeName(typeName: string, collector: ExternalTypesCollector): boolean {
  if (collector.allExports.some((exp) => exp.name === typeName)) {
    return true;
  }
  if (collector.typeNameMap) {
    // Check if the typeName matches any dotted name in the typeNameMap
    if (
      Object.values(collector.typeNameMap).some(
        (dotted) => dotted === typeName || dotted.endsWith(`.${typeName}`),
      )
    ) {
      return true;
    }
    // Check if the typeName is the underlying type name of any exported type alias.
    // e.g., BaseOrientation is the underlying type of TabsRootOrientation which maps to
    // Tabs.Root.Orientation — so BaseOrientation is effectively an own type.
    if (
      collector.allExports.some(
        (exp) =>
          'typeName' in exp.type &&
          (exp.type as { typeName?: tae.TypeName }).typeName?.name === typeName &&
          collector.typeNameMap![exp.name] !== undefined,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Members of a union, with preserved type operators replaced by the keys they resolve to.
 *
 * `'muted' | keyof Config` reads as a plain literal union to someone reading the docs, and
 * it reached this module as one until the parser started preserving the operator.
 *
 * `maybeCollectExternalUnion` needs this to decide whether every member is a literal. When
 * formatting, the operator branch below would produce the same text on its own; flattening
 * first is what lets `uniq` dedupe a key against a sibling listed next to the operator.
 */
function resolvedUnionMembers(type: tae.UnionNode): tae.AnyType[] {
  return type.types.flatMap((member) => {
    if (!isTypeOperatorType(member) || member.resolvedType === undefined) {
      return member;
    }
    return isUnionType(member.resolvedType) ? member.resolvedType.types : member.resolvedType;
  });
}

/**
 * Formats an external type definition as a simple type string.
 * This produces a concise representation suitable for documentation.
 * Note: This function always expands types - it's used for showing the full
 * definition in the "External Types" section, not for inline type display.
 */
export function formatExternalTypeDefinition(type: tae.AnyType): string {
  if (isUnionType(type)) {
    // Always expand union types - don't use typeName since we want the full definition
    const members = resolvedUnionMembers(type).map((t) => formatExternalTypeDefinition(t));
    return uniq(members).join(' | ');
  }

  if (isTypeOperatorType(type)) {
    // This section shows full definitions, so an operator is worth more as the keys it
    // stands for than as its authored syntax.
    if (type.resolvedType !== undefined) {
      return formatExternalTypeDefinition(type.resolvedType);
    }
    // `keyof` binds tighter than both composers, so a composite operand has to be grouped.
    return `${type.operator} ${groupType(formatExternalTypeDefinition(type.type), UNION_OR_INTERSECTION)}`;
  }

  if (isTypeQueryType(type)) {
    return `typeof ${type.expressionName}`;
  }

  if (isLiteralType(type)) {
    const value = type.value;
    // Ensure string literals are quoted with single quotes
    if (typeof value === 'string') {
      // Strip any existing quotes and wrap with single quotes
      const unquoted = value.replace(/^["']|["']$/g, '');
      return `'${unquoted}'`;
    }
    return String(value);
  }

  if (isTemplateLiteralType(type)) {
    return formatTemplateLiteral(type, formatExternalTypeDefinition);
  }

  if (isIntrinsicType(type)) {
    return type.intrinsic;
  }

  if (isExternalType(type)) {
    return type.typeName.name;
  }

  if (isArrayType(type)) {
    const elementType = formatExternalTypeDefinition(type.elementType);
    return elementType.includes(' ') ? `(${elementType})[]` : `${elementType}[]`;
  }

  if (isObjectType(type)) {
    const props = (type.properties || [])
      .map((p) => {
        const propType = formatExternalTypeDefinition(p.type as tae.AnyType);
        return p.optional ? `${p.name}?: ${propType}` : `${p.name}: ${propType}`;
      })
      .join('; ');
    return `{ ${props} }`;
  }

  return 'unknown';
}

/**
 * Formats a function type signature for external type documentation.
 * Produces a readable representation like `(data: { side: Side; align: Align }) => number`.
 */
export function formatFunctionSignature(type: tae.FunctionNode): string {
  const signatures = type.callSignatures.map((sig) => {
    const params = sig.parameters
      .map((p) => {
        const paramType = formatExternalTypeDefinition(p.type as tae.AnyType);
        return p.optional ? `${p.name}?: ${paramType}` : `${p.name}: ${paramType}`;
      })
      .join(', ');
    const returnType = formatExternalTypeDefinition(sig.returnValueType);
    return `(${params}) => ${returnType}`;
  });

  return signatures.length > 1
    ? signatures.map((sig) => `(${sig})`).join(' | ')
    : signatures[0] || '() => void';
}

/**
 * Whether a type is a literal, a simple intrinsic (string, number, boolean), or a template
 * literal whose placeholders are all simple intrinsics.
 */
function isLiteralLike(type: tae.AnyType): boolean {
  if (isTemplateLiteralType(type)) {
    return type.types.every(isLiteralLike);
  }
  return (
    isLiteralType(type) ||
    (isIntrinsicType(type) && ['string', 'number', 'boolean'].includes(type.intrinsic))
  );
}

/**
 * Attempts to collect a named union type as an external type during formatting.
 * Only collects if:
 * - The type has a name
 * - ALL members are literals, simple intrinsics (string, number, boolean), or template literals
 *   whose placeholders are simple intrinsics
 * - The type is not in allExports (not an own type)
 * - The type is not a built-in namespace
 * - The optional pattern filter matches
 */
export function maybeCollectExternalUnion(
  type: tae.UnionNode,
  collector: ExternalTypesCollector,
): void {
  const typeName = type.typeName?.name;
  if (!typeName) {
    return;
  }

  // Already collected
  if (collector.collected.has(typeName)) {
    return;
  }

  // Pattern filter
  if (collector.pattern && !collector.pattern.test(typeName)) {
    return;
  }

  // Built-in type
  if (isBuiltInTypeName(type.typeName!)) {
    return;
  }

  // Own type (in exports or typeNameMap)
  if (isOwnTypeName(typeName, collector)) {
    return;
  }

  // Only collect if ALL members are literals
  const allMembersAreLiterals = resolvedUnionMembers(type).every(isLiteralLike);

  if (allMembersAreLiterals) {
    collector.collected.set(typeName, {
      name: typeName,
      definition: formatExternalTypeDefinition(type),
    });
  }
}

/**
 * Attempts to collect a named template literal type as an external type during formatting.
 * Only collects if:
 * - The type has a name
 * - ALL placeholders are simple intrinsics (string, number, boolean)
 * - The type is not in allExports (not an own type)
 * - The type is not a built-in namespace
 * - The optional pattern filter matches
 */
export function maybeCollectExternalTemplateLiteral(
  type: tae.TemplateLiteralNode,
  collector: ExternalTypesCollector,
): void {
  const typeName = type.typeName?.name;
  if (!typeName) {
    return;
  }

  // Already collected
  if (collector.collected.has(typeName)) {
    return;
  }

  // Pattern filter
  if (collector.pattern && !collector.pattern.test(typeName)) {
    return;
  }

  // Built-in type
  if (isBuiltInTypeName(type.typeName!)) {
    return;
  }

  // Own type (in exports or typeNameMap)
  if (isOwnTypeName(typeName, collector)) {
    return;
  }

  // Only collect if ALL placeholders are simple intrinsics, as unions require of their members
  if (isLiteralLike(type)) {
    collector.collected.set(typeName, {
      name: typeName,
      definition: formatExternalTypeDefinition(type),
    });
  }
}

/**
 * Attempts to collect a named function type as an external type during formatting.
 * Only collects named function types that aren't ComponentRenderFn, own types, or built-in.
 */
export function maybeCollectExternalFunction(
  type: tae.FunctionNode,
  collector: ExternalTypesCollector,
): void {
  const typeName = type.typeName?.name;
  if (!typeName || typeName.startsWith('ComponentRenderFn')) {
    return;
  }

  // Already collected
  if (collector.collected.has(typeName)) {
    return;
  }

  // Pattern filter
  if (collector.pattern && !collector.pattern.test(typeName)) {
    return;
  }

  // Built-in type
  if (isBuiltInTypeName(type.typeName!)) {
    return;
  }

  // Own type (in exports or typeNameMap)
  if (isOwnTypeName(typeName, collector)) {
    return;
  }

  collector.collected.set(typeName, {
    name: typeName,
    definition: formatFunctionSignature(type),
  });
}

/**
 * Attempts to collect an external type reference (from node_modules) as an external type.
 * Looks up the type in allExports to see if it's a re-exported union/literal.
 */
export function maybeCollectExternalReference(
  type: tae.ExternalTypeNode,
  collector: ExternalTypesCollector,
): void {
  const typeName = type.typeName.name;

  // Already collected
  if (collector.collected.has(typeName)) {
    return;
  }

  // Pattern filter
  if (collector.pattern && !collector.pattern.test(typeName)) {
    return;
  }

  // Built-in type
  if (isBuiltInTypeName(type.typeName)) {
    return;
  }

  // Own type (already documented via typeNameMap)
  if (isOwnTypeName(typeName, collector)) {
    return;
  }

  // Look for the type definition in allExports (for re-exported types)
  const exportNode = collector.allExports.find((node) => node.name === typeName);
  if (exportNode) {
    const resolvedType = exportNode.type as tae.AnyType;
    if (resolvedType && (isUnionType(resolvedType) || isLiteralType(resolvedType))) {
      collector.collected.set(typeName, {
        name: typeName,
        definition: formatExternalTypeDefinition(resolvedType),
      });
    }
  }
}
