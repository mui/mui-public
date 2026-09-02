import type * as tae from 'typescript-api-extractor';

/**
 * Type namespaces the reader is expected to know, which these docs are therefore not
 * responsible for describing.
 */
const BUILT_IN_NAMESPACES = ['React', 'JSX', 'HTML', 'CSS', 'SVG', 'Omit', 'Pick', 'Partial'];

/**
 * Matches a type name against the built-in list. Namespaces always match in full;
 * `nameMatches` decides how strictly the bare name is compared.
 */
function matchesBuiltIn(
  typeName: tae.TypeName,
  nameMatches: (name: string, builtIn: string) => boolean,
): boolean {
  const name = typeName.name || '';
  return BUILT_IN_NAMESPACES.some(
    (builtIn) => nameMatches(name, builtIn) || (typeName.namespaces?.includes(builtIn) ?? false),
  );
}

/**
 * Checks if a type name belongs to a built-in namespace that should be skipped
 * during external type collection.
 */
export function isBuiltInTypeName(typeName: tae.TypeName): boolean {
  return matchesBuiltIn(typeName, (name, builtIn) => name.startsWith(builtIn));
}

/** The name a type is written as, for the node kinds that carry one. */
function namedAs(type: tae.AnyType): tae.TypeName | undefined {
  return 'typeName' in type ? type.typeName : undefined;
}

/**
 * Whether a name, and everything it wraps, is built-in.
 *
 * A wrapper qualifies only when its arguments do too: the keys of `Omit<Config, 'size'>`
 * come from `Config`, so naming the wrapper would describe nothing.
 *
 * The bare name is compared in full here, where `isBuiltInTypeName` compares a prefix.
 * Over-matching only costs a repeated definition when deciding what to collect, but this
 * decides whether a type's members are shown at all, so a `PickerConfig` of ours must not
 * be taken for the built-in `Pick`.
 */
function namesOnlyBuiltIns(typeName: tae.TypeName): boolean {
  if (!matchesBuiltIn(typeName, (name, builtIn) => name === builtIn)) {
    return false;
  }
  return (typeName.typeArguments ?? []).every((argument) => {
    const argumentName = namedAs(argument.type);
    // Literals and intrinsics name nothing, so they cannot disqualify their wrapper.
    return argumentName === undefined || namesOnlyBuiltIns(argumentName);
  });
}

/**
 * Whether a type is one the reader already knows, rather than one these docs describe.
 */
export function isBuiltInTypeReference(type: tae.AnyType): boolean {
  const typeName = namedAs(type);
  return typeName !== undefined && namesOnlyBuiltIns(typeName);
}
