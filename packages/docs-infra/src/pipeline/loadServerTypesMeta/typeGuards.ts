import type * as tae from 'typescript-api-extractor';

/**
 * Base type guard helper to check if a value has a specific kind property.
 * Validates that the value is an object with a 'kind' property matching the expected value.
 */
function hasKind(value: unknown, kind: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === kind
  );
}

/**
 * Type guard to check if a type node is an external type reference.
 * Works with both class instances and serialized objects from typescript-api-extractor.
 */
export function isExternalType(type: unknown): type is tae.ExternalTypeNode {
  return hasKind(type, 'external');
}

/**
 * Type guard to check if a type node is an intrinsic (built-in) type.
 */
export function isIntrinsicType(type: unknown): type is tae.IntrinsicNode {
  return hasKind(type, 'intrinsic');
}

/**
 * Type guard to check if a type node is a union type.
 */
export function isUnionType(type: unknown): type is tae.UnionNode {
  return hasKind(type, 'union');
}

/**
 * Type guard to check if a type node is an intersection type.
 */
export function isIntersectionType(type: unknown): type is tae.IntersectionNode {
  return hasKind(type, 'intersection');
}

/**
 * Type guard to check if a type node is an object type.
 */
export function isObjectType(type: unknown): type is tae.ObjectNode {
  return hasKind(type, 'object');
}

/**
 * Checks if an object type is anonymous (no authored type name).
 * Anonymous objects have no typeName or use TypeScript internal names like __type, __object.
 * Named types like `DialogHandle<Payload>` are NOT anonymous and should be kept as type references.
 */
export function isAnonymousObjectType(type: tae.ObjectNode): boolean {
  return !type.typeName || isInternalTypeName(type.typeName.name);
}

/**
 * Type guard to check if a type node is an array type.
 */
export function isArrayType(type: unknown): type is tae.ArrayNode {
  return hasKind(type, 'array');
}

/**
 * Type guard to check if a type node is a class type.
 * Uses a local type definition since ClassNode may not be exported from older versions.
 */
export function isClassType(type: unknown): type is { kind: 'class' } {
  return hasKind(type, 'class');
}

/**
 * Type guard to check if a type node is a function type.
 */
export function isFunctionType(type: unknown): type is tae.FunctionNode {
  return hasKind(type, 'function');
}

/**
 * Type guard to check if a type node is a literal type.
 */
export function isLiteralType(type: unknown): type is tae.LiteralNode {
  return hasKind(type, 'literal');
}

/**
 * Type guard to check if a type node is an enum type.
 */
export function isEnumType(type: unknown): type is tae.EnumNode {
  return hasKind(type, 'enum');
}

/**
 * Type guard to check if a type node is a tuple type.
 */
export function isTupleType(type: unknown): type is tae.TupleNode {
  return hasKind(type, 'tuple');
}

/**
 * Type guard to check if a type node is a type parameter.
 */
export function isTypeParameterType(type: unknown): type is tae.TypeParameterNode {
  return hasKind(type, 'typeParameter');
}

/**
 * Type guard to check if a type node is a component type.
 */
export function isComponentType(type: unknown): type is tae.ComponentNode {
  return hasKind(type, 'component');
}

/**
 * Checks if a type name is a TypeScript internal symbol name.
 * Internal names like __object, __type, __function are used by TypeScript
 * for anonymous type declarations and should not be displayed in output.
 */
export function isInternalTypeName(name: string | undefined): boolean {
  return name != null && name.startsWith('__');
}
