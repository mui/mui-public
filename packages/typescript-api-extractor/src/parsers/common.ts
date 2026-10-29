import ts from 'typescript';
import type { TypeArgument } from '../models/typeName';
import { TypeName } from '../models/typeName';
import { resolveType } from './typeResolver';
import type { ScopedParserContext } from '../parserContext';
import {
  containsKeyofTypeOperatorOrAlias,
  substituteTypeParameterTypeNode,
} from './typeResolvers/typeOperatorTypeNodes';
import { getReferenceEntityName, resolveImportAlias } from './typeResolvers/referencedTypeAlias';

/**
 * Known TypeScript compiler-generated internal symbol names.
 * These are names the compiler assigns to anonymous or synthetic symbols
 * and should not appear in parsed output as real type names.
 *
 * See: TypeScript's `InternalSymbolName` enum in `src/compiler/types.ts`.
 */
const TS_INTERNAL_SYMBOL_NAMES = new Set([
  '__call',
  '__constructor',
  '__new',
  '__index',
  '__export',
  '__global',
  '__missing',
  '__type',
  '__object',
  '__jsxAttributes',
  '__class',
  '__function',
  '__computed',
  '__resolving__',
  '__instantiationExpression',
  '__importAttributes',
]);

/**
 * Returns true if the given name is a TypeScript compiler-internal symbol name
 * (e.g., `__type`, `__object`, `__function`). These are assigned to anonymous
 * or synthetic symbols and are not meaningful user-authored type names.
 *
 * This does NOT match arbitrary user-authored names that happen to start with `__`.
 */
export function isInternalSymbolName(name: string): boolean {
  return TS_INTERNAL_SYMBOL_NAMES.has(name);
}

/**
 * Extracts namespace parts from a qualified name node.
 * For example, `ComponentRoot.ChangeEventDetails` returns `['ComponentRoot']`.
 */
function getQualifiedNameNamespaces(typeNodeName: ts.EntityName): string[] {
  const namespaces: string[] = [];
  let current: ts.EntityName = typeNodeName;

  // Walk left through the qualified name, collecting namespace parts
  while (ts.isQualifiedName(current)) {
    // Move to the left side
    current = current.left;
    // If the left side is an identifier, it's a namespace
    if (ts.isIdentifier(current)) {
      namespaces.unshift(current.text);
    }
  }

  return namespaces;
}

/**
 * Derives the public `TypeName` for a type: its name, enclosing namespaces, and
 * type arguments. When an authored `typeNode` is available it is used to recover
 * the originally written alias name and namespace path, which TypeScript discards
 * when it resolves simple aliases. Returns undefined for anonymous/unnameable types.
 */
export function getFullName(
  type: ts.Type,
  typeNode: ts.TypeNode | undefined,
  context: ScopedParserContext,
): TypeName | undefined {
  return getFullNameWithSymbol(type, typeNode, context)?.typeName;
}

/**
 * Same as `getFullName`, but also returns the symbol the name was read from, so
 * callers can inspect the declaration behind the name.
 */
export function getFullNameWithSymbol(
  type: ts.Type,
  typeNode: ts.TypeNode | undefined,
  context: ScopedParserContext,
): { typeName: TypeName; symbol: ts.Symbol } | undefined {
  const { checker } = context;

  // The following code handles cases where the type is a simple alias of another type (type Alias = SomeType).
  // TypeScript resolves the alias automatically, but we want to preserve the original type symbol if it exists.
  //
  // However, this also covers cases where the type is a type parameter (as in `type Generic<T> = { value: T }`).
  // Here we don't want to preserve T as a type symbol, but rather resolve it to its actual type.
  let typeSymbol: ts.Symbol | undefined;
  let qualifiedNameNamespaces: string[] = [];
  const typeNodeName = getReferenceEntityName(typeNode);
  if (typeNodeName) {
    let typeSymbolCandidate: ts.Symbol | undefined;
    if (ts.isIdentifier(typeNodeName)) {
      typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);
    } else if (ts.isQualifiedName(typeNodeName)) {
      typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
      // Extract namespace parts from the qualified name itself
      // This handles cases like `ComponentRoot.ChangeEventDetails` where
      // `ComponentRoot` is used as a namespace qualifier in the type reference
      qualifiedNameNamespaces = getQualifiedNameNamespaces(typeNodeName);
    }

    if (
      typeSymbolCandidate &&
      !areEquivalent(typeNodeName, type, checker) &&
      !(typeSymbolCandidate.flags & ts.SymbolFlags.TypeParameter)
    ) {
      typeSymbol = typeSymbolCandidate;
    }
  }

  const named = getTypeName(type, typeSymbol);
  // Use namespaces from the symbol/type first, but fall back to qualified name namespaces
  // when the type doesn't have intrinsic namespace information
  let namespaces = typeSymbol ? getTypeSymbolNamespaces(typeSymbol) : getTypeNamespaces(type);
  if (namespaces.length === 0 && qualifiedNameNamespaces.length > 0) {
    namespaces = qualifiedNameNamespaces;
  }
  const typeArguments = getTypeArguments(type, typeNode, typeSymbol, context);

  if (named === undefined) {
    return undefined;
  }

  return {
    typeName: createTypeName(
      named.symbol,
      context,
      named.name,
      namespaces.length > 0 ? namespaces : undefined,
      typeArguments.length > 0 ? typeArguments : undefined,
    ),
    symbol: named.symbol,
  };
}

/**
 * Creates the `TypeName` of a type named after `symbol`, with the names under
 * which the parsed module exports that symbol. Parsers create every `TypeName`
 * here or through `copyTypeName` (enforced by lint), so none loses its export
 * names. Pass no symbol for a name that doesn't come from one, such as a type
 * parameter.
 */
export function createTypeName(
  symbol: ts.Symbol | undefined,
  context: ScopedParserContext,
  name: string,
  namespaces?: readonly string[],
  typeArguments?: readonly TypeArgument[],
): TypeName {
  const target = resolveImportAlias(symbol, context.checker);
  return new TypeName(
    name,
    namespaces,
    typeArguments,
    target ? context.exportNamesBySymbol.get(target) : undefined,
  );
}

/**
 * Copies a `TypeName` of the same symbol, optionally under another name,
 * keeping its export names.
 */
export function copyTypeName(typeName: TypeName, name = typeName.name): TypeName {
  return new TypeName(name, typeName.namespaces, typeName.typeArguments, typeName.exportedAs);
}

/**
 * Returns the names of the namespace/module declarations enclosing a type's
 * declaration, outermost first (e.g. `['Dialog']` for a type declared in
 * `namespace Dialog`).
 */
export function getTypeNamespaces(type: ts.Type): string[] {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) {
    return [];
  }

  return getTypeSymbolNamespaces(symbol);
}

function getTypeSymbolNamespaces(typeSymbol: ts.Symbol): string[] {
  // Skip TypeScript internal symbol names (e.g., __type, __object, __function)
  if (isInternalSymbolName(typeSymbol.name)) {
    return [];
  }

  const declaration = typeSymbol.valueDeclaration ?? typeSymbol.declarations?.[0];
  if (!declaration) {
    return [];
  }

  const namespaces: string[] = [];
  let currentNode = declaration.parent;

  while (currentNode != null && !ts.isSourceFile(currentNode)) {
    if (ts.isModuleDeclaration(currentNode)) {
      namespaces.unshift(currentNode.name.getText());
    }

    currentNode = currentNode.parent;
  }

  return namespaces;
}

function typeSymbolIsNonGenericAlias(typeSymbol: ts.Symbol): boolean {
  const decl = typeSymbol.declarations?.[0];
  if (!decl) {
    return false;
  }
  if (ts.isTypeAliasDeclaration(decl) || ts.isInterfaceDeclaration(decl)) {
    return !decl.typeParameters || decl.typeParameters.length === 0;
  }
  return false;
}

function getTypeName(
  type: ts.Type,
  typeSymbol: ts.Symbol | undefined,
): { name: string; symbol: ts.Symbol } | undefined {
  const symbol = typeSymbol ?? type.aliasSymbol ?? type.getSymbol();
  if (!symbol) {
    return undefined;
  }

  // When TypeScript has lost both aliasSymbol and symbol on the resolved type
  // (e.g. due to `& {}` flattening), the typeSymbol from the authored typeNode
  // may still be valid — but only if it's a non-generic alias.
  // Generic aliases (like `ReasonToEvent<Reason>`) have stale typeNode references
  // after TypeScript instantiates the type parameters, so we must discard them.
  if (typeSymbol && !type.aliasSymbol && !type.getSymbol()) {
    if (!typeSymbolIsNonGenericAlias(typeSymbol)) {
      return undefined;
    }
  }

  // A module object (`import * as api`) is named after the module's absolute
  // file path, which identifies the checkout rather than a public type.
  if (symbol.declarations?.some(ts.isSourceFile)) {
    return undefined;
  }

  const typeName = symbol.getName();

  // Filter out TypeScript internal symbol names (e.g., __type for anonymous type literals,
  // __object for anonymous object literals, __function for anonymous functions).
  // These are not meaningful type names and should not appear in the output.
  if (isInternalSymbolName(typeName)) {
    // If we have a typeSymbol from the typeNode, use its name instead
    if (typeSymbol && !isInternalSymbolName(typeSymbol.getName())) {
      return { name: typeSymbol.getName(), symbol: typeSymbol };
    }
    return undefined;
  }

  return { name: typeName, symbol };
}

function getTypeArguments(
  type: ts.Type,
  typeNode: ts.TypeNode | undefined,
  typeSymbol: ts.Symbol | undefined,
  context: ScopedParserContext,
): TypeArgument[] {
  let typeArguments: TypeArgument[] = [];

  const authoredTypeArguments =
    typeNode && (ts.isTypeReferenceNode(typeNode) || ts.isImportTypeNode(typeNode))
      ? (typeNode.typeArguments ?? [])
      : [];
  const nodeTypeArguments = authoredTypeArguments.map((argument) => {
    const substituted = substituteTypeParameterTypeNode(
      argument,
      context.checker,
      context.typeParameterTypeNodeSubstitutions,
    );
    return containsKeyofTypeOperatorOrAlias(
      substituted,
      context.checker,
      new Set(),
      context.includeExternalTypes,
    )
      ? substituted
      : argument;
  });

  // When the type name comes from the typeNode symbol (e.g., `TabsLikeDetails` from the authored
  // source) rather than from TypeScript's resolved type, the aliasSymbol/aliasTypeArguments may
  // belong to a _different_ type (the inner generic the alias wraps). In this case, we should only
  // use type arguments that actually appear on the authored typeNode reference.
  if (typeSymbol && type.aliasSymbol && typeSymbol !== type.aliasSymbol) {
    // The typeNode reference determines the type arguments — if the authored code writes
    // `TabsLikeDetails` (no angle brackets), there are no type arguments.
    // Evaluate equalToDefault against the authored alias (typeSymbol), not the resolved
    // inner type, since the outer and inner generics may have different defaults.
    typeArguments = nodeTypeArguments.map((argNode, index) => {
      const argType = context.checker.getTypeFromTypeNode(argNode);
      const parameterType = resolveType(argType, argNode, context);
      const equalToDefault = isArgumentSameAsSymbolDefault(
        argType,
        index,
        typeSymbol,
        context.checker,
      );
      return { type: parameterType, equalToDefault } satisfies TypeArgument;
    });
    return typeArguments;
  }

  if (type.aliasSymbol && !type.aliasTypeArguments) {
    typeArguments = [];
  } else {
    if ('target' in type) {
      typeArguments = context.checker
        .getTypeArguments(type as ts.TypeReference)
        ?.map((arg, index) => {
          const parameterType = resolveType(arg, nodeTypeArguments[index], context);
          const equalToDefault = isGenericArgumentsSameAsDefault(type, index, context.checker);

          return {
            type: parameterType,
            equalToDefault,
          } satisfies TypeArgument;
        });
    }

    if (!typeArguments.length) {
      typeArguments =
        type.aliasTypeArguments?.map((arg, index) => {
          const parameterType = resolveType(arg, nodeTypeArguments[index], context);
          resolveType(arg, undefined, context);
          const equalToDefault = isGenericArgumentsSameAsDefault(type, index, context.checker);

          return {
            type: parameterType,
            equalToDefault,
          } satisfies TypeArgument;
        }) ?? [];
    }

    // Intrinsic string mappings such as `Capitalize<T>` are neither references nor alias
    // instantiations, so their only type argument is the mapped type itself.
    if (
      !typeArguments.length &&
      type.flags & ts.TypeFlags.StringMapping &&
      (!typeSymbol || typeSymbol === type.getSymbol())
    ) {
      typeArguments = [
        {
          type: resolveType((type as ts.StringMappingType).type, nodeTypeArguments[0], context),
          equalToDefault: false,
        },
      ];
    }
  }

  return typeArguments;
}

/**
 * Checks whether a type argument matches the default of a specific symbol's declaration.
 * Used when the authored alias differs from the resolved type's alias.
 */
function isArgumentSameAsSymbolDefault(
  argumentType: ts.Type,
  argumentIndex: number,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  if (!symbol.declarations || symbol.declarations.length === 0) {
    return false;
  }

  const declaration = symbol.declarations[0];

  if (
    !ts.isInterfaceDeclaration(declaration) &&
    !ts.isTypeAliasDeclaration(declaration) &&
    !ts.isClassDeclaration(declaration) &&
    !ts.isFunctionDeclaration(declaration)
  ) {
    return false;
  }

  const typeParameters = declaration.typeParameters;
  if (!typeParameters || argumentIndex >= typeParameters.length) {
    return false;
  }

  const typeParameterDeclaration = typeParameters[argumentIndex];
  if (!typeParameterDeclaration.default) {
    return false;
  }

  const defaultType = checker.getTypeFromTypeNode(typeParameterDeclaration.default);
  return argumentType === defaultType;
}

function isGenericArgumentsSameAsDefault(
  type: ts.Type, // The instantiated type, e.g., Props<string>
  argumentIndex: number,
  checker: ts.TypeChecker,
): boolean {
  let typeArguments: readonly ts.Type[] | undefined;
  let targetSymbol: ts.Symbol | undefined;

  // Prefer the alias path when available: aliasSymbol corresponds to the authored
  // type reference (e.g. `Outer`), while the ObjectReference target may point to
  // a different inner generic (`Inner`) with different defaults.
  if (type.aliasSymbol && type.aliasTypeArguments) {
    typeArguments = type.aliasTypeArguments;
    targetSymbol = type.aliasSymbol;
  } else if (
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
  ) {
    typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    const targetType = (type as ts.TypeReference).target;
    targetSymbol = targetType.getSymbol();
  } else {
    typeArguments = type.aliasTypeArguments;
    targetSymbol = type.aliasSymbol;
  }

  if (!typeArguments || typeArguments.length === 0) {
    return true; // No arguments to compare
  }

  if (argumentIndex >= typeArguments.length) {
    return false;
  }

  if (!targetSymbol?.declarations || targetSymbol.declarations.length === 0) {
    return false;
  }

  const declaration = targetSymbol.declarations[0];

  if (
    !ts.isInterfaceDeclaration(declaration) &&
    !ts.isTypeAliasDeclaration(declaration) &&
    !ts.isClassDeclaration(declaration) &&
    !ts.isFunctionDeclaration(declaration)
  ) {
    return false;
  }

  const typeParameters = declaration.typeParameters;
  if (!typeParameters || typeParameters.length < typeArguments.length) {
    return false;
  }

  const argumentType = typeArguments[argumentIndex];
  const typeParameterDeclaration = typeParameters[argumentIndex];
  if (!typeParameterDeclaration) {
    return false;
  }

  if (!typeParameterDeclaration.default) {
    return false; // Argument provided for a parameter without a default
  }

  const defaultType = checker.getTypeFromTypeNode(typeParameterDeclaration.default);

  if (argumentType !== defaultType) {
    return false;
  }

  return true;
}

function areEquivalent(
  typeNodeName: ts.EntityName,
  type: ts.Type,
  checker: ts.TypeChecker,
): boolean | undefined {
  if (ts.isIdentifier(typeNodeName)) {
    const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName);
    if (!typeSymbolCandidate) {
      return undefined;
    }

    return (
      typeNodeName.text === type.aliasSymbol?.name &&
      getTypeSymbolNamespaces(typeSymbolCandidate).join('.') === getTypeNamespaces(type).join('.')
    );
  }
  if (ts.isQualifiedName(typeNodeName)) {
    const typeSymbolCandidate = checker.getSymbolAtLocation(typeNodeName.right);
    if (!typeSymbolCandidate) {
      return undefined;
    }

    return (
      typeNodeName.right.text === type.aliasSymbol?.name &&
      getTypeSymbolNamespaces(typeSymbolCandidate).join('.') === getTypeNamespaces(type).join('.')
    );
  }

  return undefined;
}
