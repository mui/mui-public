import type * as tae from 'typescript-api-extractor';

/**
 * Type namespaces the reader is expected to know, which these docs are therefore not
 * responsible for describing.
 */
const BUILT_IN_NAMESPACES = ['React', 'JSX', 'HTML', 'CSS', 'SVG', 'Omit', 'Pick', 'Partial'];

/**
 * Checks if a type name belongs to a built-in namespace.
 *
 * Names are compared whole: a `PickerConfig` of ours is not the built-in `Pick`.
 */
export function isBuiltInTypeName(typeName: tae.TypeName): boolean {
  return BUILT_IN_NAMESPACES.some(
    (builtIn) => typeName.name === builtIn || (typeName.namespaces?.includes(builtIn) ?? false),
  );
}

/** The name a type is written as, for the node kinds that carry one. */
function namedAs(type: tae.AnyType): tae.TypeName | undefined {
  return 'typeName' in type ? type.typeName : undefined;
}

/**
 * Whether a type is one the reader already knows, rather than one these docs describe.
 *
 * A wrapper qualifies only when its arguments do too: the keys of `Omit<Config, 'size'>`
 * come from `Config`, so naming the wrapper would describe nothing.
 */
export function isBuiltInTypeReference(type: tae.AnyType): boolean {
  const typeName = namedAs(type);
  if (typeName === undefined || !isBuiltInTypeName(typeName)) {
    return false;
  }
  return (
    typeName.typeArguments?.every(
      // Literals and intrinsics name nothing, so they cannot disqualify their wrapper.
      (argument) => namedAs(argument.type) === undefined || isBuiltInTypeReference(argument.type),
    ) ?? true
  );
}
