import ts from 'typescript';
import { declarationHasNodeModulesPathSegment } from './sourceFileUtils';
import { deriveTypeParameterBindings, type TypeParameterBindings } from './typeParameterBindings';
import {
	getReferencedInterfaceOrClassDeclaration,
	getReferencedTypeAliasDeclaration,
} from './typeResolvers/referencedTypeAlias';
import {
	containsKeyofTypeOperatorOrAlias,
	getPreservableKeyofTypeNode,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
} from './typeResolvers/typeOperatorTypeNodes';

/**
 * Derives semantic and authored bindings for a generic reference whose
 * arguments or declaration defaults contain preservable `keyof` syntax. Alias
 * parameters and the parameters of the terminal interface or class are kept in
 * one map so member and signature resolvers see the same instantiated argument.
 *
 * @param typeNode - Authored generic reference to inspect.
 * @param checker - Checker used to follow aliases and bind declaration parameters.
 * @param includeExternalTypes - Whether bindings may traverse external declarations.
 * @param baseBindings - Active outer bindings to extend.
 * @returns Extended bindings, or `undefined` when the reference needs no source replay.
 */
export function getAuthoredTypeReferenceBindings(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	baseBindings?: TypeParameterBindings,
): TypeParameterBindings | undefined {
	if (!typeNode) {
		return undefined;
	}

	const reference = unwrapParenthesizedTypeNode(typeNode);
	const typeArguments = getReferenceTypeArguments(reference);
	const referencedDeclaration =
		getReferencedTypeAliasDeclaration(reference, checker) ??
		getReferencedInterfaceOrClassDeclaration(reference, checker);
	const declarationArgumentContainsKeyof = declarationArgumentsContainKeyof(
		typeArguments,
		referencedDeclaration?.typeParameters,
		checker,
		includeExternalTypes,
		baseBindings?.typeNodes,
	);
	if (
		!declarationArgumentContainsKeyof &&
		!typeArguments?.some((argument) =>
			containsKeyofTypeOperatorOrAlias(
				argument,
				checker,
				new Set(),
				includeExternalTypes,
				baseBindings?.typeNodes,
			),
		)
	) {
		return undefined;
	}

	return followAuthoredTypeReferenceBindings(
		reference,
		checker,
		includeExternalTypes,
		baseBindings,
		new Set(),
		new Set(),
	);
}

/**
 * Derives bindings introduced by the `extends` chains of an interface or
 * class-backed semantic type. The collector starts from checker declarations
 * because exported declarations do not have a root TypeReference node at
 * resolver dispatch.
 *
 * @param type - Semantic interface or class type whose declarations own the heritage clauses.
 * @param checker - Checker used to resolve base declarations and arguments.
 * @param includeExternalTypes - Whether bindings may traverse external declarations.
 * @param baseBindings - Active root-reference or outer bindings to extend.
 * @returns Extended bindings, or `undefined` when no heritage binding was added.
 */
export function getAuthoredHeritageBindings(
	type: ts.Type,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	baseBindings?: TypeParameterBindings,
): TypeParameterBindings | undefined {
	const symbol = type.aliasSymbol ?? type.getSymbol();
	const declarations = symbol?.declarations?.filter(
		(declaration): declaration is ts.InterfaceDeclaration | ts.ClassDeclaration =>
			ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration),
	);
	if (!declarations?.length) {
		return undefined;
	}

	let bindings = baseBindings;
	let addedBindings = false;
	for (const declaration of declarations) {
		const declarationBindings = followDeclarationHeritageBindings(
			declaration,
			checker,
			includeExternalTypes,
			bindings,
			new Set(),
		);
		if (declarationBindings) {
			bindings = declarationBindings;
			addedBindings = true;
		}
	}

	return addedBindings ? bindings : undefined;
}

function followAuthoredTypeReferenceBindings(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	baseBindings: TypeParameterBindings | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
	seenHeritageDeclarations: Set<ts.InterfaceDeclaration | ts.ClassDeclaration>,
): TypeParameterBindings | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, baseBindings?.typeNodes);
	const declaration = getReferencedTypeAliasDeclaration(substituted, checker);
	if (declaration) {
		if (
			seenAliases.has(declaration) ||
			(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
		) {
			return baseBindings;
		}

		const bindings =
			deriveTypeParameterBindings({
				checker,
				declarations: declaration.typeParameters,
				authoredArguments: getReferenceTypeArguments(substituted),
				baseTypes: baseBindings?.types,
				baseTypeNodes: baseBindings?.typeNodes,
				useDeclarationDefaults: true,
				substituteArgumentTypes: true,
				bodyForFreshSymbols: declaration.type,
			}) ?? baseBindings;
		const nextSeenAliases = new Set(seenAliases);
		nextSeenAliases.add(declaration);
		return followAuthoredTypeReferenceBindings(
			declaration.type,
			checker,
			includeExternalTypes,
			bindings,
			nextSeenAliases,
			seenHeritageDeclarations,
		);
	}

	const genericDeclaration = getReferencedInterfaceOrClassDeclaration(substituted, checker);
	if (
		!genericDeclaration ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(genericDeclaration))
	) {
		return baseBindings;
	}

	const bindings =
		deriveTypeParameterBindings({
			checker,
			declarations: genericDeclaration.typeParameters,
			authoredArguments: getReferenceTypeArguments(substituted),
			baseTypes: baseBindings?.types,
			baseTypeNodes: baseBindings?.typeNodes,
			useDeclarationDefaults: true,
			substituteArgumentTypes: true,
			bodyForFreshSymbols: genericDeclaration,
		}) ?? baseBindings;
	return (
		followDeclarationHeritageBindings(
			genericDeclaration,
			checker,
			includeExternalTypes,
			bindings,
			seenHeritageDeclarations,
		) ?? bindings
	);
}

function followDeclarationHeritageBindings(
	declaration: ts.InterfaceDeclaration | ts.ClassDeclaration,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	baseBindings: TypeParameterBindings | undefined,
	seenDeclarations: Set<ts.InterfaceDeclaration | ts.ClassDeclaration>,
): TypeParameterBindings | undefined {
	if (
		seenDeclarations.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}

	const heritageTypes = declaration.heritageClauses
		?.filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
		.flatMap((clause) => [...clause.types]);
	if (!heritageTypes?.length) {
		return undefined;
	}

	const nextSeenDeclarations = new Set(seenDeclarations);
	nextSeenDeclarations.add(declaration);
	let bindings = baseBindings;
	let addedBindings = false;
	for (const heritageType of heritageTypes) {
		const heritageBindings = followHeritageTypeBindings(
			heritageType,
			checker,
			includeExternalTypes,
			bindings,
			new Set(),
			nextSeenDeclarations,
		);
		if (heritageBindings) {
			bindings = heritageBindings;
			addedBindings = true;
		}
	}

	return addedBindings ? bindings : undefined;
}

function followHeritageTypeBindings(
	typeNode: ts.ExpressionWithTypeArguments,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	baseBindings: TypeParameterBindings | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
	seenHeritageDeclarations: Set<ts.InterfaceDeclaration | ts.ClassDeclaration>,
): TypeParameterBindings | undefined {
	const symbol = checker.getSymbolAtLocation(typeNode.expression);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	const aliasDeclaration = targetSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
	if (aliasDeclaration) {
		if (
			seenAliases.has(aliasDeclaration) ||
			(!includeExternalTypes && declarationHasNodeModulesPathSegment(aliasDeclaration))
		) {
			return undefined;
		}

		const bindings =
			deriveTypeParameterBindings({
				checker,
				declarations: aliasDeclaration.typeParameters,
				authoredArguments: typeNode.typeArguments,
				baseTypes: baseBindings?.types,
				baseTypeNodes: baseBindings?.typeNodes,
				useDeclarationDefaults: true,
				substituteArgumentTypes: true,
				bodyForFreshSymbols: aliasDeclaration.type,
			}) ?? baseBindings;
		const aliasContainsKeyof = getPreservableKeyofTypeNode(
			aliasDeclaration.type,
			checker,
			bindings?.typeNodes,
			includeExternalTypes,
		);
		const targetMembersContainKeyof = referencedDeclarationMembersContainKeyof(
			aliasDeclaration.type,
			checker,
			includeExternalTypes,
			bindings,
			new Set(seenAliases).add(aliasDeclaration),
		);
		if (!aliasContainsKeyof && !targetMembersContainKeyof) {
			return undefined;
		}
		const nextSeenAliases = new Set(seenAliases);
		nextSeenAliases.add(aliasDeclaration);
		const followedBindings = followAuthoredTypeReferenceBindings(
			aliasDeclaration.type,
			checker,
			includeExternalTypes,
			bindings,
			nextSeenAliases,
			seenHeritageDeclarations,
		);
		return followedBindings !== baseBindings ? followedBindings : undefined;
	}

	const genericDeclaration = targetSymbol?.declarations?.find(
		(declaration): declaration is ts.InterfaceDeclaration | ts.ClassDeclaration =>
			ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration),
	);
	if (
		!genericDeclaration ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(genericDeclaration))
	) {
		return undefined;
	}

	const bindings =
		deriveTypeParameterBindings({
			checker,
			declarations: genericDeclaration.typeParameters,
			authoredArguments: typeNode.typeArguments,
			baseTypes: baseBindings?.types,
			baseTypeNodes: baseBindings?.typeNodes,
			useDeclarationDefaults: true,
			substituteArgumentTypes: true,
			bodyForFreshSymbols: genericDeclaration,
		}) ?? baseBindings;
	const heritageBindings = followDeclarationHeritageBindings(
		genericDeclaration,
		checker,
		includeExternalTypes,
		bindings,
		seenHeritageDeclarations,
	);
	const argumentContainsKeyof = declarationArgumentsContainKeyof(
		typeNode.typeArguments,
		genericDeclaration.typeParameters,
		checker,
		includeExternalTypes,
		baseBindings?.typeNodes,
	);
	const memberContainsKeyof = declarationMembersContainKeyof(
		genericDeclaration,
		checker,
		includeExternalTypes,
		bindings?.typeNodes,
	);
	return (
		heritageBindings ??
		((argumentContainsKeyof || memberContainsKeyof) && bindings !== baseBindings
			? bindings
			: undefined)
	);
}

/**
 * Follows a heritage alias to determine whether its terminal interface or
 * class members need authored `keyof` replay. The traversal composes each
 * alias's bindings so `type Alias<T> = Base<T>` reaches `Base<P>` rather than
 * inspecting the uninstantiated base declaration.
 *
 * @param typeNode - Alias body or terminal generic reference to inspect.
 * @param checker - Checker used to resolve aliases and generic declarations.
 * @param includeExternalTypes - Whether traversal may enter external declarations.
 * @param baseBindings - Bindings accumulated before this reference.
 * @param seenAliases - Alias declarations already visited on this path.
 * @returns Whether a terminal declaration member contains replayable `keyof` syntax.
 */
function referencedDeclarationMembersContainKeyof(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	baseBindings: TypeParameterBindings | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
): boolean {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, baseBindings?.typeNodes);
	const aliasDeclaration = getReferencedTypeAliasDeclaration(substituted, checker);
	if (aliasDeclaration) {
		if (
			seenAliases.has(aliasDeclaration) ||
			(!includeExternalTypes && declarationHasNodeModulesPathSegment(aliasDeclaration))
		) {
			return false;
		}
		const bindings =
			deriveTypeParameterBindings({
				checker,
				declarations: aliasDeclaration.typeParameters,
				authoredArguments: getReferenceTypeArguments(substituted),
				baseTypes: baseBindings?.types,
				baseTypeNodes: baseBindings?.typeNodes,
				useDeclarationDefaults: true,
				substituteArgumentTypes: true,
				bodyForFreshSymbols: aliasDeclaration.type,
			}) ?? baseBindings;
		const nextSeenAliases = new Set(seenAliases);
		nextSeenAliases.add(aliasDeclaration);
		return referencedDeclarationMembersContainKeyof(
			aliasDeclaration.type,
			checker,
			includeExternalTypes,
			bindings,
			nextSeenAliases,
		);
	}

	const genericDeclaration = getReferencedInterfaceOrClassDeclaration(substituted, checker);
	if (
		!genericDeclaration ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(genericDeclaration))
	) {
		return false;
	}
	const bindings =
		deriveTypeParameterBindings({
			checker,
			declarations: genericDeclaration.typeParameters,
			authoredArguments: getReferenceTypeArguments(substituted),
			baseTypes: baseBindings?.types,
			baseTypeNodes: baseBindings?.typeNodes,
			useDeclarationDefaults: true,
			substituteArgumentTypes: true,
			bodyForFreshSymbols: genericDeclaration,
		}) ?? baseBindings;
	return (
		declarationMembersContainKeyof(
			genericDeclaration,
			checker,
			includeExternalTypes,
			bindings?.typeNodes,
		) ||
		followDeclarationHeritageBindings(
			genericDeclaration,
			checker,
			includeExternalTypes,
			bindings,
			new Set(),
		) != null
	);
}

/**
 * Detects member syntax that needs the declaration's instantiated authored
 * bindings. Without retaining those bindings, an inherited `keyof T` operand
 * is replayed with the base declaration's now-out-of-scope `T` instead of the
 * concrete heritage argument.
 *
 * @param declaration - Instantiated interface or class declaration.
 * @param checker - Checker used to follow member aliases.
 * @param includeExternalTypes - Whether alias traversal may enter external declarations.
 * @param substitutions - Authored bindings for the declaration's type parameters.
 * @returns Whether a member contains replayable `keyof` syntax.
 */
function declarationMembersContainKeyof(
	declaration: ts.InterfaceDeclaration | ts.ClassDeclaration,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): boolean {
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (
			ts.isTypeNode(node) &&
			getPreservableKeyofTypeNode(node, checker, substitutions, includeExternalTypes)
		) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	for (const member of declaration.members) {
		visit(member);
	}
	return found;
}

function declarationArgumentsContainKeyof(
	typeArguments: readonly ts.TypeNode[] | undefined,
	typeParameters: readonly ts.TypeParameterDeclaration[] | undefined,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): boolean {
	return (
		typeParameters?.some((parameter, index) =>
			Boolean(
				getPreservableKeyofTypeNode(
					typeArguments?.[index] ?? parameter.default,
					checker,
					substitutions,
					includeExternalTypes,
				),
			),
		) ?? false
	);
}

function getReferenceTypeArguments(typeNode: ts.TypeNode): readonly ts.TypeNode[] | undefined {
	return ts.isTypeReferenceNode(typeNode) || ts.isImportTypeNode(typeNode)
		? typeNode.typeArguments
		: undefined;
}
