import ts from 'typescript';

/**
 * Checks whether a declaration comes from TypeScript's bundled library
 * definitions. Built-in detection relies on this because a symbol name alone
 * cannot distinguish a lib type from a project type that shadows it.
 *
 * @param declaration - Declaration whose source file should be inspected.
 * @returns Whether the declaration is part of TypeScript's bundled libs.
 */
export function isTypeScriptLibDeclaration(declaration: ts.Declaration): boolean {
	return /[\\/]typescript[\\/]lib[\\/]lib\..+\.d\.ts$/.test(declaration.getSourceFile().fileName);
}

/**
 * Identifies an authored reference to TypeScript's built-in array interfaces.
 *
 * The symbol name alone is insufficient because projects may shadow `Array`
 * or `ReadonlyArray`. Aliases are followed before checking that the target is
 * an interface declared by TypeScript's bundled library definitions.
 *
 * @param typeNode - Authored type reference whose resolved target should be inspected.
 * @param checker - Checker used to resolve aliases and declarations.
 * @returns The built-in interface name, or `undefined` for non-array and shadowed references.
 */
export function getBuiltInArrayReferenceName(
	typeNode: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
): 'Array' | 'ReadonlyArray' | undefined {
	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	if (
		!targetSymbol ||
		!['Array', 'ReadonlyArray'].includes(targetSymbol.getName()) ||
		!(targetSymbol.flags & ts.SymbolFlags.Interface)
	) {
		return undefined;
	}

	const isBuiltIn = targetSymbol.declarations?.some(isTypeScriptLibDeclaration) ?? false;
	return isBuiltIn ? (targetSymbol.getName() as 'Array' | 'ReadonlyArray') : undefined;
}

/**
 * Detects whether a semantic array reference targets TypeScript's built-in `ReadonlyArray`.
 *
 * The symbol name alone is insufficient because user code can declare another
 * `ReadonlyArray`; the declaration must also come from TypeScript's lib files.
 *
 * @param type - Checker type that may be a reference to a built-in array target.
 * @returns Whether the semantic target is the built-in readonly array interface.
 */
export function isSemanticallyReadonlyArray(type: ts.Type): boolean {
	const targetSymbol =
		type.flags & ts.TypeFlags.Object && 'target' in type
			? (type as ts.TypeReference).target.symbol
			: undefined;
	return (
		targetSymbol?.name === 'ReadonlyArray' &&
		Boolean(targetSymbol.declarations?.some(isTypeScriptLibDeclaration))
	);
}

/**
 * Reads TypeScript's semantic readonly marker from a tuple target.
 * The `target.readonly` field is compiler-internal tuple metadata, so access is
 * kept in this helper instead of being repeated by individual resolvers.
 *
 * @param type - Checker type that may be a tuple reference.
 * @returns Whether TypeScript marks the tuple target as readonly.
 */
export function isSemanticallyReadonlyTuple(type: ts.Type): boolean {
	return 'target' in type && Boolean((type as ts.TupleTypeReference).target.readonly);
}

/** Authored tuple element after transparent named, optional, and rest wrappers are removed. */
export interface TupleElementSyntax {
	/** Innermost authored type node used for nested type resolution. */
	typeNode: ts.TypeNode;
	/** Whether any removed wrapper represented a rest element. */
	isRest: boolean;
}

/**
 * Removes named, rest, and optional tuple wrappers while retaining rest metadata.
 *
 * TypeScript can nest these wrappers, for example a named rest member whose
 * inner type is another `RestTypeNode`, so the function unwraps until it reaches
 * the element type used for semantic resolution.
 *
 * @param typeNode - Authored tuple element syntax.
 * @returns The innermost type node and whether the element is a rest element.
 */
export function unwrapTupleElementSyntax(typeNode: ts.TypeNode): TupleElementSyntax {
	let current = typeNode;
	let isRest = false;

	if (ts.isNamedTupleMember(current)) {
		isRest = current.dotDotDotToken != null;
		current = current.type;
	}

	while (ts.isOptionalTypeNode(current) || ts.isRestTypeNode(current)) {
		isRest ||= ts.isRestTypeNode(current);
		current = current.type;
	}

	return { typeNode: current, isRest };
}

/**
 * Checks whether authored tuple element syntax represents a rest element.
 *
 * @param typeNode - Tuple element syntax to inspect.
 * @returns Whether a named or unnamed rest wrapper is present.
 */
export function isRestTupleElementNode(typeNode: ts.TypeNode): boolean {
	return unwrapTupleElementSyntax(typeNode).isRest;
}
