import { uniq } from 'es-toolkit';
import type * as tae from 'typescript-api-extractor';
import {
  isExternalType,
  isIntrinsicType,
  isUnionType,
  isObjectType,
  isLiteralType,
} from './typeGuards';

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
  /** All exports in the module, used to identify own types */
  allExports: tae.ExportNode[];
  /** Optional pattern to filter which external types to include */
  pattern?: RegExp;
  /** Map of original export names to dotted display names, used to identify renamed own types */
  typeNameMap?: Record<string, string>;
}

/**
 * Built-in type namespaces that should not be collected as external types.
 */
const BUILT_IN_NAMESPACES = ['React', 'JSX', 'HTML', 'CSS', 'SVG', 'Omit', 'Pick', 'Partial'];

/**
 * Checks if a type name belongs to a built-in namespace that should be skipped
 * during external type collection.
 */
export function isBuiltInTypeName(typeName: tae.TypeName): boolean {
  const name = typeName.name || '';
  return BUILT_IN_NAMESPACES.some(
    (ns) => name.startsWith(ns) || (typeName.namespaces?.includes(ns) ?? false),
  );
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
 * Formats an external type definition as a simple type string.
 * This produces a concise representation suitable for documentation.
 * Note: This function always expands types - it's used for showing the full
 * definition in the "External Types" section, not for inline type display.
 */
export function formatExternalTypeDefinition(type: tae.AnyType): string {
  if (isUnionType(type)) {
    // Always expand union types - don't use typeName since we want the full definition
    const members = type.types.map((t) => formatExternalTypeDefinition(t));
    return uniq(members).join(' | ');
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

  if (isIntrinsicType(type)) {
    return type.intrinsic;
  }

  if (isExternalType(type)) {
    return type.typeName.name;
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
 * Attempts to collect a named union type as an external type during formatting.
 * Only collects if:
 * - The type has a name
 * - ALL members are literals or simple intrinsics (string, number, boolean)
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
  const allMembersAreLiterals = type.types.every(
    (t) =>
      isLiteralType(t) ||
      (isIntrinsicType(t) && ['string', 'number', 'boolean'].includes(t.intrinsic)),
  );

  if (allMembersAreLiterals) {
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
