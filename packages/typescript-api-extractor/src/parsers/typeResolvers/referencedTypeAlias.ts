import ts from 'typescript';

/**
 * Returns the entity name that authored reference syntax is written with.
 *
 * Both ordinary references (`Alias<T>`) and import types
 * (`import('./module').Alias<T>`) are covered so callers cannot drift in which
 * reference forms they support. Transparent parentheses are ignored; all other
 * syntax returns `undefined`.
 *
 * @param typeNode - Authored syntax that may reference a named type.
 * @returns The reference's name, or the import type's qualifier.
 */
export function getReferenceEntityName(
	typeNode: ts.TypeNode | undefined,
): ts.EntityName | undefined {
	let reference = typeNode;
	while (reference && ts.isParenthesizedTypeNode(reference)) {
		reference = reference.type;
	}

	if (!reference) {
		return undefined;
	}

	if (ts.isTypeReferenceNode(reference)) {
		return reference.typeName;
	}

	return ts.isImportTypeNode(reference) ? reference.qualifier : undefined;
}

/**
 * Follows an import or re-export to the symbol it points at.
 *
 * @param symbol - Symbol that may be an import alias.
 * @param checker - Checker used to resolve the alias.
 * @returns The aliased symbol, or `symbol` itself when it is not an alias.
 */
export function resolveImportAlias(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): ts.Symbol | undefined {
	return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * Returns the type-alias declaration named by authored reference syntax.
 *
 * @param typeNode - Authored syntax that may reference a type alias.
 * @param checker - Checker used to resolve and follow import aliases.
 * @returns The referenced type-alias declaration, when one exists.
 */
export function getReferencedTypeAliasDeclaration(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
	const location = getReferenceEntityName(typeNode);
	const targetSymbol = location
		? resolveImportAlias(checker.getSymbolAtLocation(location), checker)
		: undefined;
	return targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
}

/**
 * Returns the interface or class declaration named by authored reference syntax.
 *
 * Nominal declarations carry their own type parameters, so generic binding and
 * `keyof` replay have to agree on which declaration a reference points at.
 *
 * @param typeNode - Authored syntax that may reference an interface or class.
 * @param checker - Checker used to resolve and follow import aliases.
 * @returns The referenced interface or class declaration, when one exists.
 */
export function getReferencedInterfaceOrClassDeclaration(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): ts.InterfaceDeclaration | ts.ClassDeclaration | undefined {
	const location = getReferenceEntityName(typeNode);
	const targetSymbol = location
		? resolveImportAlias(checker.getSymbolAtLocation(location), checker)
		: undefined;
	return targetSymbol?.declarations?.find(
		(declaration): declaration is ts.InterfaceDeclaration | ts.ClassDeclaration =>
			ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration),
	);
}
