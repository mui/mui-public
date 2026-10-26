import ts from 'typescript';
import {
	getBuiltInArrayReferenceName,
	isTypeScriptLibDeclaration,
	unwrapTupleElementSyntax,
} from '../typeContainerUtils';
import { areSemanticTypesEquivalent } from '../typeResolutionUtils';
import {
	declarationHasNodeModulesPathSegment,
	hasNodeModulesPathSegment,
} from '../sourceFileUtils';
import { deriveTypeParameterBindings } from '../typeParameterBindings';
import { getReferencedTypeAliasDeclaration } from './referencedTypeAlias';

/**
 * Removes parenthesized wrappers that are transparent to type-operator resolution.
 *
 * @param typeNode - Authored syntax to unwrap.
 * @returns The first non-parenthesized type node.
 */
export function unwrapParenthesizedTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
	let unwrapped = typeNode;
	while (ts.isParenthesizedTypeNode(unwrapped)) {
		unwrapped = unwrapped.type;
	}

	return unwrapped;
}

/**
 * Removes parentheses, readonly operators, and TypeScript's built-in
 * `Readonly<T>` utility while locating an array or tuple container. The
 * checker-backed utility test prevents a user-defined alias with the same name
 * from being treated as transparent.
 *
 * @param typeNode - Authored container syntax to unwrap.
 * @param checker - Optional checker used to identify the built-in `Readonly` alias.
 * @param substitutions - Active authored generic substitutions applied after each wrapper.
 * @returns The underlying non-readonly container node.
 */
export function unwrapReadonlyContainerTypeNode(
	typeNode: ts.TypeNode,
	checker?: ts.TypeChecker,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): ts.TypeNode {
	let unwrapped = unwrapParenthesizedTypeNode(typeNode);
	while (true) {
		if (checker) {
			const substituted = substituteTypeParameterTypeNode(unwrapped, checker, substitutions);
			if (substituted !== unwrapped) {
				unwrapped = unwrapParenthesizedTypeNode(substituted);
				continue;
			}
		}
		if (ts.isTypeOperatorNode(unwrapped) && unwrapped.operator === ts.SyntaxKind.ReadonlyKeyword) {
			unwrapped = unwrapParenthesizedTypeNode(unwrapped.type);
			continue;
		}
		if (checker && isBuiltInReadonlyUtilityReference(unwrapped, checker)) {
			unwrapped = unwrapParenthesizedTypeNode(unwrapped.typeArguments![0]!);
			continue;
		}
		break;
	}

	return unwrapped;
}

function isBuiltInReadonlyUtilityReference(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): typeNode is ts.TypeReferenceNode & { typeArguments: ts.NodeArray<ts.TypeNode> } {
	if (!ts.isTypeReferenceNode(typeNode) || typeNode.typeArguments?.length !== 1) {
		return false;
	}

	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return (
		targetSymbol?.name === 'Readonly' &&
		Boolean(targetSymbol.declarations?.some(isBuiltInReadonlyUtilityDeclaration))
	);
}

/**
 * Identifies TypeScript's built-in `Readonly<T>` alias declaration. A name
 * check alone is insufficient because projects may shadow `Readonly` locally.
 *
 * @param declaration - Declaration proposed as the built-in utility alias.
 * @returns Whether the declaration is `Readonly` from a TypeScript lib file.
 */
export function isBuiltInReadonlyUtilityDeclaration(
	declaration: ts.Declaration,
): declaration is ts.TypeAliasDeclaration {
	return (
		ts.isTypeAliasDeclaration(declaration) &&
		declaration.name.text === 'Readonly' &&
		isTypeScriptLibDeclaration(declaration)
	);
}

/**
 * Locates a root authored `keyof` node after removing transparent parentheses.
 *
 * @param typeNode - Optional authored syntax to inspect.
 * @returns The root `keyof` node, or `undefined` for any other shape.
 */
export function getKeyofTypeOperatorNode(
	typeNode: ts.TypeNode | undefined,
): ts.TypeOperatorNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return ts.isTypeOperatorNode(unwrapped) && unwrapped.operator === ts.SyntaxKind.KeyOfKeyword
		? unwrapped
		: undefined;
}

/**
 * Checks whether a syntax subtree contains an authored `keyof` expression.
 *
 * @param typeNode - Optional syntax subtree to traverse.
 * @returns Whether any descendant is a `keyof` operator.
 */
export function containsKeyofTypeOperator(typeNode: ts.TypeNode | undefined): boolean {
	if (!typeNode) {
		return false;
	}

	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}

		if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
			found = true;
			return;
		}

		ts.forEachChild(node, visit);
	};
	visit(typeNode);

	return found;
}

/**
 * Replaces a root type-parameter reference with its active authored argument.
 *
 * Only bare root references are substituted. Rewriting arbitrary descendants
 * here would manufacture syntax the caller did not author and would overlap
 * the dedicated nested-substitution probe. The seen-symbol set also protects
 * malformed or mutually recursive substitution maps.
 *
 * @param typeNode - Authored root syntax that may name a type parameter.
 * @param checker - Checker used to resolve the referenced parameter symbol.
 * @param substitutions - Active mapping from parameter symbols to authored arguments.
 * @returns The terminal substituted root node, or the original node when no binding applies.
 */
export function substituteTypeParameterTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): ts.TypeNode {
	let substituted = typeNode;
	const seen = new Set<ts.Symbol>();
	while (substitutions) {
		const unwrapped = unwrapParenthesizedTypeNode(substituted);
		if (!ts.isTypeReferenceNode(unwrapped) || unwrapped.typeArguments?.length) {
			break;
		}
		const symbol = checker.getSymbolAtLocation(unwrapped.typeName);
		if (!symbol || seen.has(symbol)) {
			break;
		}
		const replacement = substitutions.get(symbol);
		if (!replacement) {
			break;
		}
		seen.add(symbol);
		substituted = replacement;
	}

	return substituted;
}

/**
 * Checks whether a syntax subtree receives `keyof` through an active authored argument.
 *
 * @param typeNode - Optional syntax subtree containing type references.
 * @param checker - Checker used to resolve type-parameter symbols and alias declarations.
 * @param substitutions - Active authored type-parameter arguments.
 * @param includeExternalTypes - Whether alias traversal may enter external declarations.
 * @param seenIndexedAccesses - Indexed-access syntax already expanded on this path.
 * @returns Whether substituting any referenced parameter exposes preservable `keyof` syntax.
 */
export function containsKeyofTypeNodeSubstitution(
	typeNode: ts.Node | undefined,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes = false,
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): boolean {
	if (!typeNode || !substitutions?.size) {
		return false;
	}

	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isTypeReferenceNode(node)) {
			const substituted = substituteTypeParameterTypeNode(node, checker, substitutions);
			if (
				substituted !== node &&
				containsKeyofTypeOperatorOrAlias(
					substituted,
					checker,
					new Set(),
					includeExternalTypes,
					substitutions,
					undefined,
					seenIndexedAccesses,
				)
			) {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
	return found;
}

/**
 * Applies root substitutions and keeps only syntax capable of replaying `keyof`.
 *
 * @param typeNode - Optional authored syntax proposed for nested resolution.
 * @param checker - Checker used for parameter and alias lookups.
 * @param substitutions - Active authored generic substitutions.
 * @param includeExternalTypes - Whether alias traversal may enter external declarations.
 * @param seenIndexedAccesses - Indexed-access syntax already expanded on this path.
 * @returns Preservable substituted syntax, or `undefined` when semantic resolution is sufficient.
 */
export function getPreservableKeyofTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): ts.TypeNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	// `substituteTypeParameterTypeNode` only rewrites a bare root reference, so
	// nested parameters survive in the returned syntax (`T['value']` keeps its
	// `T`). The active arguments have to travel with the traversal for those to
	// resolve, exactly as they do for the sibling probes below.
	return containsKeyofTypeOperator(substituted) ||
		containsKeyofTypeOperatorOrAlias(
			substituted,
			checker,
			new Set(),
			includeExternalTypes,
			substitutions,
			undefined,
			seenIndexedAccesses,
		) ||
		containsKeyofTypeReferenceArgumentOrAlias(
			substituted,
			checker,
			includeExternalTypes,
			substitutions,
			seenIndexedAccesses,
		) ||
		containsKeyofTypeNodeSubstitution(
			substituted,
			checker,
			substitutions,
			includeExternalTypes,
			seenIndexedAccesses,
		)
		? substituted
		: undefined;
}

/**
 * Checks authored syntax and supported alias/container chains for a `keyof` expression.
 *
 * Traversal is deliberately limited to transparent containers whose output can
 * faithfully replay a nested operator. The alias set prevents recursive alias
 * graphs, and external traversal follows the caller's public expansion policy.
 *
 * @param typeNode - Optional authored syntax or alias reference to inspect.
 * @param checker - Checker used to follow local, imported, and qualified aliases.
 * @param seenAliases - Alias declarations already visited by the current traversal.
 * @param includeExternalTypes - Whether traversal may enter external aliases.
 * @param substitutions - Active authored arguments for generic alias parameters.
 * @param seenAliasInstantiations - Generic alias bindings already visited on this path.
 * @param seenIndexedAccesses - Indexed-access syntax already expanded on this path.
 * @returns Whether replayable `keyof` syntax is reachable.
 */
export function containsKeyofTypeOperatorOrAlias(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	seenAliases: Set<ts.TypeAliasDeclaration> = new Set(),
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
	seenAliasInstantiations: Map<ts.TypeAliasDeclaration, Set<string>> = new Map(),
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): boolean {
	if (!typeNode) {
		return false;
	}

	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapReadonlyContainerTypeNode(substituted, checker, substitutions);
	if (getKeyofTypeOperatorNode(unwrapped)) {
		return true;
	}
	if (ts.isArrayTypeNode(unwrapped)) {
		return containsKeyofTypeOperatorOrAlias(
			unwrapped.elementType,
			checker,
			seenAliases,
			includeExternalTypes,
			substitutions,
			seenAliasInstantiations,
			seenIndexedAccesses,
		);
	}
	if (ts.isTupleTypeNode(unwrapped)) {
		return unwrapped.elements.some((element) =>
			containsKeyofTypeOperatorOrAlias(
				unwrapTupleElementSyntax(element).typeNode,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
				seenIndexedAccesses,
			),
		);
	}
	if (ts.isUnionTypeNode(unwrapped) || ts.isIntersectionTypeNode(unwrapped)) {
		return unwrapped.types.some((member) =>
			containsKeyofTypeOperatorOrAlias(
				member,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
				seenIndexedAccesses,
			),
		);
	}
	if (ts.isConditionalTypeNode(unwrapped)) {
		return (
			containsKeyofTypeOperatorOrAlias(
				unwrapped.trueType,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
				seenIndexedAccesses,
			) ||
			containsKeyofTypeOperatorOrAlias(
				unwrapped.falseType,
				checker,
				seenAliases,
				includeExternalTypes,
				substitutions,
				seenAliasInstantiations,
				seenIndexedAccesses,
			)
		);
	}
	if (ts.isIndexedAccessTypeNode(unwrapped)) {
		// Expanding an indexed access resolves the selected property back to
		// authored syntax, which may itself be an indexed access that selects the
		// original property (`interface Foo { a: Foo['a'] }`, or the same loop
		// spread across two interfaces). Following such a chain never reaches
		// terminal syntax, so a repeat visit means no `keyof` is replayable here.
		if (seenIndexedAccesses.has(unwrapped)) {
			return false;
		}
		const nextSeenIndexedAccesses = new Set(seenIndexedAccesses).add(unwrapped);

		const indexType = checker.getTypeFromTypeNode(unwrapped.indexType);
		let sourceTypeNodes = getIndexedAccessSourceTypeNodes(
			unwrapped,
			checker,
			includeExternalTypes,
			substitutions,
		);
		if (!sourceTypeNodes && indexType.flags & ts.TypeFlags.Number) {
			sourceTypeNodes = getTupleNumberIndexedTypeNodes(
				unwrapped.objectType,
				checker,
				includeExternalTypes,
				substitutions,
			);
		}
		if (!sourceTypeNodes && indexType.isNumberLiteral()) {
			sourceTypeNodes = getTupleLiteralIndexedSourceTypeNodes(
				unwrapped.objectType,
				indexType.value,
				checker,
				includeExternalTypes,
				substitutions,
			);
		}
		return sourceTypeNodes
			? sourceTypeNodes.some((sourceTypeNode) =>
					Boolean(
						followTypeAliasToKeyofSource(
							sourceTypeNode,
							checker,
							includeExternalTypes,
							substitutions,
							new Set(),
							nextSeenIndexedAccesses,
						),
					),
				)
			: Boolean(
					getIndexedAccessKeyofSourceTypeNode(
						unwrapped,
						checker,
						includeExternalTypes,
						substitutions,
						nextSeenIndexedAccesses,
					),
				);
	}
	if (ts.isImportTypeNode(unwrapped)) {
		const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
		const aliasSubstitutions = declaration
			? getAliasTypeNodeSubstitutions(declaration, unwrapped.typeArguments, checker, substitutions)
			: undefined;
		const instantiationKey = declaration
			? getAliasInstantiationKey(declaration, aliasSubstitutions, checker)
			: undefined;
		if (
			!declaration ||
			(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration)) ||
			hasSeenAliasInstantiation(declaration, instantiationKey, seenAliases, seenAliasInstantiations)
		) {
			return false;
		}
		const nextSeenAliases = new Set(seenAliases);
		nextSeenAliases.add(declaration);
		const nextSeenAliasInstantiations = addSeenAliasInstantiation(
			declaration,
			instantiationKey,
			seenAliasInstantiations,
		);
		return containsKeyofTypeOperatorOrAlias(
			declaration.type,
			checker,
			nextSeenAliases,
			includeExternalTypes,
			aliasSubstitutions,
			nextSeenAliasInstantiations,
			seenIndexedAccesses,
		);
	}
	if (!ts.isTypeReferenceNode(unwrapped)) {
		return false;
	}

	// Resolve the reference rather than matching its name: a project may declare
	// its own `Array`/`ReadonlyArray`, and interfaces are opaque to this
	// traversal unless they really are the transparent built-in containers.
	if (getBuiltInArrayReferenceName(unwrapped, checker)) {
		return (
			unwrapped.typeArguments?.some((argument) =>
				containsKeyofTypeOperatorOrAlias(
					argument,
					checker,
					seenAliases,
					includeExternalTypes,
					substitutions,
					seenAliasInstantiations,
					seenIndexedAccesses,
				),
			) ?? false
		);
	}

	const declaration =
		getReferencedTypeAliasDeclaration(unwrapped, checker) ??
		findLocalTypeAliasDeclaration(unwrapped);
	const aliasSubstitutions = declaration
		? getAliasTypeNodeSubstitutions(declaration, unwrapped.typeArguments, checker, substitutions)
		: undefined;
	const instantiationKey = declaration
		? getAliasInstantiationKey(declaration, aliasSubstitutions, checker)
		: undefined;
	if (
		!declaration ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration)) ||
		hasSeenAliasInstantiation(declaration, instantiationKey, seenAliases, seenAliasInstantiations)
	) {
		return false;
	}
	const nextSeenAliases = new Set(seenAliases);
	nextSeenAliases.add(declaration);
	const nextSeenAliasInstantiations = addSeenAliasInstantiation(
		declaration,
		instantiationKey,
		seenAliasInstantiations,
	);
	return containsKeyofTypeOperatorOrAlias(
		declaration.type,
		checker,
		nextSeenAliases,
		includeExternalTypes,
		aliasSubstitutions,
		nextSeenAliasInstantiations,
		seenIndexedAccesses,
	);
}

/**
 * Checks generic reference arguments for direct or alias-reachable `keyof`.
 * The general alias traversal intentionally treats interfaces and classes as
 * opaque; this separate boundary probe preserves their public type arguments
 * without making every reference transparent to container replay.
 *
 * @param typeNode - Authored syntax whose nested reference arguments should be inspected.
 * @param checker - Checker used to resolve aliases inside the arguments.
 * @param includeExternalTypes - Whether argument alias traversal may enter external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @param seenIndexedAccesses - Indexed-access syntax already expanded on this path.
 * @returns Whether a reference argument contains preservable `keyof` syntax.
 */
export function containsKeyofTypeReferenceArgumentOrAlias(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): boolean {
	if (!typeNode) {
		return false;
	}

	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node)) {
			found =
				node.typeArguments?.some((argument) =>
					containsKeyofTypeOperatorOrAlias(
						argument,
						checker,
						new Set(),
						includeExternalTypes,
						substitutions,
						undefined,
						seenIndexedAccesses,
					),
				) ?? false;
		}
		if (!found) {
			ts.forEachChild(node, visit);
		}
	};
	visit(substituted);
	return found;
}

/**
 * Detects a collapsed compound made entirely from the same generic wrapper
 * when at least one authored argument carries `keyof`. Requiring a common root
 * wrapper keeps this recovery path away from ordinary unions such as
 * `ExternalAlias | undefined`, while permitting an equivalent literal member
 * such as `Box<keyof T> | Box<'same'>` to remain visible.
 *
 * The probe is source-only so it cannot perturb TypeScript's lazy checker caches.
 *
 * @param typeNode - Authored union or intersection syntax to inspect.
 * @returns Whether the compound can safely replay its generic reference members.
 */
export function isKeyofReferenceCompoundReplayableInSource(
	typeNode: ts.TypeNode | undefined,
): boolean {
	if (!typeNode) {
		return false;
	}
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (
		(!ts.isUnionTypeNode(unwrapped) && !ts.isIntersectionTypeNode(unwrapped)) ||
		unwrapped.types.length < 2
	) {
		return false;
	}

	const references = unwrapped.types.map(getRootGenericReferenceInSource);
	if (references.some((reference) => !reference)) {
		return false;
	}
	const target = getGenericReferenceTargetInSource(references[0]!);
	return (
		references.every((reference) => getGenericReferenceTargetInSource(reference!) === target) &&
		references.some((reference) => containsKeyofTypeReferenceArgumentInSource(reference!))
	);
}

function getRootGenericReferenceInSource(
	typeNode: ts.TypeNode,
): ts.TypeReferenceNode | ts.ImportTypeNode | undefined {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return (ts.isTypeReferenceNode(unwrapped) || ts.isImportTypeNode(unwrapped)) &&
		unwrapped.typeArguments?.length
		? unwrapped
		: undefined;
}

function getGenericReferenceTargetInSource(
	reference: ts.TypeReferenceNode | ts.ImportTypeNode,
): string {
	return ts.isTypeReferenceNode(reference)
		? `reference:${reference.typeName.getText()}`
		: `import:${reference.argument.getText()}:${reference.qualifier?.getText() ?? ''}`;
}

function containsKeyofTypeReferenceArgumentInSource(typeNode: ts.TypeNode): boolean {
	if (
		(ts.isTypeReferenceNode(typeNode) || ts.isImportTypeNode(typeNode)) &&
		typeNode.typeArguments?.some((argument) => containsKeyofTypeOperator(argument))
	) {
		return true;
	}

	let found = false;
	ts.forEachChild(typeNode, (child) => {
		if (!found && ts.isTypeNode(child)) {
			found = containsKeyofTypeReferenceArgumentInSource(child);
		}
	});
	return found;
}

function hasSeenAliasInstantiation(
	declaration: ts.TypeAliasDeclaration,
	instantiationKey: string | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
	seenAliasInstantiations: Map<ts.TypeAliasDeclaration, Set<string>>,
): boolean {
	return instantiationKey
		? Boolean(seenAliasInstantiations.get(declaration)?.has(instantiationKey))
		: seenAliases.has(declaration);
}

function addSeenAliasInstantiation(
	declaration: ts.TypeAliasDeclaration,
	instantiationKey: string | undefined,
	seenAliasInstantiations: Map<ts.TypeAliasDeclaration, Set<string>>,
): Map<ts.TypeAliasDeclaration, Set<string>> {
	if (!instantiationKey) {
		return seenAliasInstantiations;
	}
	const next = new Map(seenAliasInstantiations);
	const declarationInstantiations = new Set(next.get(declaration));
	declarationInstantiations.add(instantiationKey);
	next.set(declaration, declarationInstantiations);
	return next;
}

function getAliasInstantiationKey(
	declaration: ts.TypeAliasDeclaration,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	checker: ts.TypeChecker,
): string | undefined {
	if (!declaration.typeParameters?.length) {
		return undefined;
	}
	return declaration.typeParameters
		.map((parameter) => {
			const symbol = checker.getSymbolAtLocation(parameter.name);
			const typeNode = symbol ? substitutions?.get(symbol) : undefined;
			return typeNode
				? `${typeNode.getSourceFile().fileName}:${typeNode.pos}:${typeNode.end}`
				: '<unbound>';
		})
		.join('|');
}

/**
 * Extends authored substitutions while descending through a generic alias.
 * Binding the declaration body, rather than merely scanning type arguments,
 * avoids treating an unused `keyof` argument as replayable syntax.
 */
function getAliasTypeNodeSubstitutions(
	declaration: ts.TypeAliasDeclaration,
	typeArguments: readonly ts.TypeNode[] | undefined,
	checker: ts.TypeChecker,
	baseTypeNodes: Map<ts.Symbol, ts.TypeNode> | undefined,
): Map<ts.Symbol, ts.TypeNode> | undefined {
	return deriveTypeParameterBindings({
		checker,
		declarations: declaration.typeParameters,
		authoredArguments: typeArguments,
		baseTypeNodes,
		useDeclarationDefaults: true,
		bodyForFreshSymbols: declaration.type,
	})?.typeNodes;
}

/**
 * Flattens authored intersection syntax while preserving source order.
 *
 * @param typeNode - Authored syntax that may be a nested intersection.
 * @returns Flat intersection members, or `undefined` when the root is not an intersection.
 */
export function flattenIntersectionTypeNodes(
	typeNode: ts.TypeNode,
): readonly ts.TypeNode[] | undefined {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isIntersectionTypeNode(unwrapped)) {
		return undefined;
	}

	return unwrapped.types.flatMap((member) => {
		const nestedMembers = flattenIntersectionTypeNodes(member);
		return nestedMembers ?? [unwrapParenthesizedTypeNode(member)];
	});
}

/**
 * Follows a literal indexed access to the selected property's authored type node.
 *
 * Numeric tuple access must map TypeScript's expanded semantic index back to
 * authored rest/suffix positions. String access follows the selected property,
 * and both forms recurse through nested indexed accesses until reaching the
 * terminal syntax that should control source-preserving resolution.
 *
 * @param typeNode - Authored indexed-access syntax to follow.
 * @param checker - Checker used to resolve the object, index, and property symbols.
 * @param includeExternalTypes - Whether selected syntax may come from external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @param seenIndexedAccesses - Indexed-access syntax already followed on this path.
 * @returns The terminal selected type node, or `undefined` when the access is not statically known.
 */
export function getIndexedAccessSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): ts.TypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapParenthesizedTypeNode(substituted);
	if (!ts.isIndexedAccessTypeNode(unwrapped)) {
		return undefined;
	}

	// A self-referential access such as `interface Foo { a: Foo['a'] }` resolves
	// back to the same syntax on every hop. `substitutions` is threaded unchanged
	// through this traversal, so revisiting a node means the arguments repeat
	// exactly and the access has no statically known terminal syntax.
	if (seenIndexedAccesses.has(unwrapped)) {
		return undefined;
	}
	const nextSeenIndexedAccesses = new Set(seenIndexedAccesses).add(unwrapped);

	const objectTypeNode = substituteTypeParameterTypeNode(
		unwrapped.objectType,
		checker,
		substitutions,
	);
	const indexTypeNode = substituteTypeParameterTypeNode(
		unwrapped.indexType,
		checker,
		substitutions,
	);
	const objectType = checker.getTypeFromTypeNode(objectTypeNode);
	const indexType = checker.getTypeFromTypeNode(indexTypeNode);
	if (indexType.isNumberLiteral()) {
		const tupleSource = getBoundTupleSourceTypeNode(
			objectTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		);
		const tupleElementTypeNodes = tupleSource
			? getTupleIndexedElementSourceTypeNodes(
					tupleSource.typeNode,
					indexType.value,
					checker,
					includeExternalTypes,
					tupleSource.substitutions,
				)
			: undefined;
		const elementTypeNode =
			tupleElementTypeNodes?.length === 1
				? tupleElementTypeNodes[0]
				: !tupleSource
					? getArrayIndexedElementTypeNode(
							objectTypeNode,
							checker,
							includeExternalTypes,
							substitutions,
						)
					: undefined;
		if (!elementTypeNode) {
			return undefined;
		}

		return (
			getIndexedAccessSourceTypeNode(
				elementTypeNode,
				checker,
				includeExternalTypes,
				substitutions,
				nextSeenIndexedAccesses,
			) ?? elementTypeNode
		);
	}
	if (indexType.flags & ts.TypeFlags.Number) {
		const tupleElementTypeNodes = getTupleNumberIndexedTypeNodes(
			objectTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		);
		const elementTypeNode =
			tupleElementTypeNodes?.length === 1
				? tupleElementTypeNodes[0]
				: getArrayIndexedElementTypeNode(
						objectTypeNode,
						checker,
						includeExternalTypes,
						substitutions,
					);
		if (elementTypeNode) {
			return (
				getIndexedAccessSourceTypeNode(
					elementTypeNode,
					checker,
					includeExternalTypes,
					substitutions,
					nextSeenIndexedAccesses,
				) ?? elementTypeNode
			);
		}
		return getIndexInfoSourceTypeNode(
			checker.getIndexInfoOfType(objectType, ts.IndexKind.Number),
			checker,
			includeExternalTypes,
			substitutions,
			nextSeenIndexedAccesses,
		);
	}

	if (indexType.flags & ts.TypeFlags.String) {
		return getIndexInfoSourceTypeNode(
			checker.getIndexInfoOfType(objectType, ts.IndexKind.String),
			checker,
			includeExternalTypes,
			substitutions,
			nextSeenIndexedAccesses,
		);
	}
	if (indexType.flags & ts.TypeFlags.ESSymbol) {
		return getIndexInfoSourceTypeNode(
			getSymbolIndexInfo(objectType, checker),
			checker,
			includeExternalTypes,
			substitutions,
			nextSeenIndexedAccesses,
		);
	}
	const property = indexType.isStringLiteral()
		? objectType.getProperty(indexType.value)
		: indexType.flags & ts.TypeFlags.UniqueESSymbol
			? getUniqueSymbolProperty(objectType, indexType, checker)
			: undefined;
	const propertyTypeNode = getPropertyTypeNode(property, checker);
	if (
		!propertyTypeNode ||
		(!includeExternalTypes && hasNodeModulesPathSegment(propertyTypeNode.getSourceFile()))
	) {
		return undefined;
	}

	return (
		getIndexedAccessSourceTypeNode(
			propertyTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
			nextSeenIndexedAccesses,
		) ?? propertyTypeNode
	);
}

/**
 * Follows a broad string, number, or symbol index to its authored value. The
 * checker owns which declaration supplies the effective index, and the
 * declaration's annotation supplies the syntax needed for `keyof` replay.
 *
 * @param indexInfo - Effective checker index information.
 * @param checker - Checker used to follow nested indexed value sources.
 * @param includeExternalTypes - Whether external index declarations may be followed.
 * @param substitutions - Active authored generic substitutions.
 * @param seenIndexedAccesses - Indexed-access syntax already followed on this path.
 * @returns The terminal authored value source, or `undefined` when unavailable.
 */
function getIndexInfoSourceTypeNode(
	indexInfo: ts.IndexInfo | undefined,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): ts.TypeNode | undefined {
	const declaration = indexInfo?.declaration;
	const valueTypeNode =
		declaration && ts.isIndexSignatureDeclaration(declaration) ? declaration.type : undefined;
	if (
		!valueTypeNode ||
		(!includeExternalTypes && hasNodeModulesPathSegment(valueTypeNode.getSourceFile()))
	) {
		return undefined;
	}
	return (
		getIndexedAccessSourceTypeNode(
			valueTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
			seenIndexedAccesses,
		) ?? valueTypeNode
	);
}

/**
 * Locates a broad symbol index, which is absent from the string/number
 * `IndexKind` enum but exposed through the checker's complete index-info list.
 *
 * @param objectType - Semantic object whose symbol index is needed.
 * @param checker - Checker used to enumerate all index information.
 * @returns The broad symbol index information, or `undefined` when absent.
 */
export function getSymbolIndexInfo(
	objectType: ts.Type,
	checker: ts.TypeChecker,
): ts.IndexInfo | undefined {
	return checker
		.getIndexInfosOfType(objectType)
		.find((indexInfo) => Boolean(indexInfo.keyType.flags & ts.TypeFlags.ESSymbol));
}

/**
 * Matches a unique-symbol index to the computed property whose declaration
 * evaluates to the same checker type. Generated escaped property names include
 * internal symbol IDs and cannot be reconstructed from `symbol.name` alone.
 *
 * @param objectType - Semantic object whose symbol-keyed property is needed.
 * @param indexType - Unique-symbol type used by the indexed access.
 * @param checker - Checker used to evaluate computed property expressions.
 * @returns The matching property symbol, or `undefined` when no exact match exists.
 */
export function getUniqueSymbolProperty(
	objectType: ts.Type,
	indexType: ts.Type,
	checker: ts.TypeChecker,
): ts.Symbol | undefined {
	return objectType.getProperties().find((property) =>
		property.declarations?.some((declaration) => {
			const name = (declaration as ts.NamedDeclaration).name;
			if (!name || !ts.isComputedPropertyName(name)) {
				return false;
			}
			const propertyNameType = checker.getTypeAtLocation(name.expression);
			return (
				propertyNameType === indexType ||
				areSemanticTypesEquivalent(propertyNameType, indexType, checker, 'exact')
			);
		}),
	);
}

/**
 * Returns the authored sources selected by finite string, number, or symbol indexes.
 * Direct unions retain their authored order. Alias, generic, and `keyof`
 * selectors use the checker's finite literal members, allowing their selected
 * properties or tuple elements to remain distinguishable after reduction.
 *
 * @param typeNode - Authored indexed access to inspect.
 * @param checker - Checker used to resolve its object, keys, and properties.
 * @param includeExternalTypes - Whether selected properties may come from external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @returns Selected property type nodes in authored key order, or `undefined` for other indexes.
 */
export function getIndexedAccessSourceTypeNodes(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): readonly ts.TypeNode[] | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapParenthesizedTypeNode(substituted);
	if (!ts.isIndexedAccessTypeNode(unwrapped)) {
		return undefined;
	}
	const objectTypeNode = substituteTypeParameterTypeNode(
		unwrapped.objectType,
		checker,
		substitutions,
	);
	const indexTypeNode = substituteTypeParameterTypeNode(
		unwrapped.indexType,
		checker,
		substitutions,
	);
	const selectors = getFiniteIndexedAccessSelectorTypes(indexTypeNode, checker);
	if (!selectors || selectors.length < 2) {
		return undefined;
	}

	const objectType = checker.getTypeFromTypeNode(objectTypeNode);
	const sources: ts.TypeNode[] = [];
	for (const selector of selectors) {
		if (selector.isNumberLiteral()) {
			const tupleSources = getTupleLiteralIndexedSourceTypeNodes(
				objectTypeNode,
				selector.value,
				checker,
				includeExternalTypes,
				substitutions,
			);
			if (tupleSources) {
				sources.push(...tupleSources);
				continue;
			}
		}
		const property =
			selector.isStringLiteral() || selector.isNumberLiteral()
				? objectType.getProperty(String(selector.value))
				: selector.flags & ts.TypeFlags.UniqueESSymbol
					? getUniqueSymbolProperty(objectType, selector, checker)
					: undefined;
		const propertyTypeNode = getPropertyTypeNode(property, checker);
		if (
			!propertyTypeNode ||
			(!includeExternalTypes && hasNodeModulesPathSegment(propertyTypeNode.getSourceFile()))
		) {
			return undefined;
		}
		sources.push(
			getIndexedAccessSourceTypeNode(
				propertyTypeNode,
				checker,
				includeExternalTypes,
				substitutions,
			) ?? propertyTypeNode,
		);
	}
	return sources.length > 1 ? sources : undefined;
}

/**
 * Expands an indexed-access selector only when every semantic member is a
 * finite string, number, or unique-symbol key. Direct union syntax is inspected
 * member by member to retain authored order; aliases and `keyof` fall back to
 * the checker's reduced union.
 *
 * @param indexTypeNode - Authored selector after root generic substitution.
 * @param checker - Checker used to evaluate selector members.
 * @returns Ordered semantic selectors, or `undefined` for open indexes.
 */
function getFiniteIndexedAccessSelectorTypes(
	indexTypeNode: ts.TypeNode,
	checker: ts.TypeChecker,
): readonly ts.Type[] | undefined {
	const authoredIndex = unwrapParenthesizedTypeNode(indexTypeNode);
	const selectorTypes = ts.isUnionTypeNode(authoredIndex)
		? authoredIndex.types.flatMap((member) => {
				const semanticMember = checker.getTypeFromTypeNode(member);
				return semanticMember.isUnion() ? semanticMember.types : [semanticMember];
			})
		: (() => {
				const semanticIndex = checker.getTypeFromTypeNode(authoredIndex);
				return semanticIndex.isUnion() ? semanticIndex.types : [semanticIndex];
			})();
	const selectors: ts.Type[] = [];
	for (const selectorType of selectorTypes) {
		if (
			selectorType.isStringLiteral() ||
			selectorType.isNumberLiteral() ||
			selectorType.flags & ts.TypeFlags.UniqueESSymbol
		) {
			if (!selectors.includes(selectorType)) {
				selectors.push(selectorType);
			}
			continue;
		}
		return undefined;
	}
	return selectors;
}

/**
 * Checks whether a root type or one of its explicit union members is an indexed access.
 * These are the syntax shapes the union resolver can use to reconstruct authored
 * member order without treating unrelated nested indexed accesses as root sources.
 *
 * @param typeNode - Authored type syntax to inspect.
 * @returns Whether the root or an explicit union member is an indexed access.
 */
export function containsIndexedAccessUnionSource(typeNode: ts.TypeNode | undefined): boolean {
	if (!typeNode) {
		return false;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return (
		ts.isIndexedAccessTypeNode(unwrapped) ||
		(ts.isUnionTypeNode(unwrapped) &&
			unwrapped.types.some((member) => containsIndexedAccessUnionSource(member)))
	);
}

/**
 * Returns every authored tuple source selected by a `number` index. Fixed,
 * optional, finite-spread, and open-rest members are expanded in source order.
 *
 * @param typeNode - Authored tuple syntax or alias reference.
 * @param checker - Checker used to follow aliases and substitutions.
 * @param includeExternalTypes - Whether tuple aliases may come from external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @returns Selected tuple sources, or `undefined` for non-tuple or unresolved inputs.
 */
export function getTupleNumberIndexedTypeNodes(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): readonly ts.TypeNode[] | undefined {
	const tupleSource = getBoundTupleSourceTypeNode(
		typeNode,
		checker,
		includeExternalTypes,
		substitutions,
	);
	if (!tupleSource) {
		return undefined;
	}
	return getTupleNumberIndexedSourcesFromTuple(
		tupleSource.typeNode,
		checker,
		includeExternalTypes,
		tupleSource.substitutions,
		[tupleSource],
	);
}

/**
 * Flattens every element that a tuple-wide `number` index can select. Finite
 * tuple spreads recurse with binding-aware cycle detection, while open array
 * rests contribute their element node. Optional wrappers are intentionally
 * removed here; the resolver restores `undefined` from the indexed access's
 * semantic result after replaying all authored sources.
 *
 * @param tupleTypeNode - Bound authored tuple whose selectable sources are needed.
 * @param checker - Checker used to follow nested tuple and array rests.
 * @param includeExternalTypes - Whether nested rest aliases may be external.
 * @param substitutions - Authored generic bindings active for this tuple.
 * @param seenTupleSources - Bound tuple frames already visited on this path.
 * @returns Flat selectable element nodes, or `undefined` for an unresolved or cyclic rest.
 */
function getTupleNumberIndexedSourcesFromTuple(
	tupleTypeNode: ts.TupleTypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenTupleSources: readonly BoundTupleSourceTypeNode[] = [],
): readonly ts.TypeNode[] | undefined {
	const sources: ts.TypeNode[] = [];
	for (const element of tupleTypeNode.elements) {
		const syntax = unwrapTupleElementSyntax(element);
		const elementTypeNode = substituteTypeParameterTypeNode(
			syntax.typeNode,
			checker,
			substitutions,
		);
		if (!syntax.isRest) {
			sources.push(elementTypeNode);
			continue;
		}

		const tupleSource = getBoundTupleSourceTypeNode(
			elementTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		);
		if (tupleSource) {
			if (hasTupleSourceFrame(seenTupleSources, tupleSource)) {
				return undefined;
			}
			const nestedSources = getTupleNumberIndexedSourcesFromTuple(
				tupleSource.typeNode,
				checker,
				includeExternalTypes,
				tupleSource.substitutions,
				[...seenTupleSources, tupleSource],
			);
			if (!nestedSources) {
				return undefined;
			}
			sources.push(...nestedSources);
			continue;
		}

		const arrayElementTypeNode = getArrayIndexedElementTypeNode(
			elementTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		);
		if (!arrayElementTypeNode) {
			return undefined;
		}
		sources.push(arrayElementTypeNode);
	}
	return sources;
}

/**
 * Returns every authored tuple element that can occupy a literal numeric index.
 *
 * Finite spreads are expanded exactly. When an open rest precedes a suffix, the
 * result includes both the rest element and every suffix element that can slide
 * into the requested index for some valid rest length.
 *
 * @param typeNode - Authored tuple syntax or alias reference.
 * @param index - Zero-based literal index to inspect.
 * @param checker - Checker used to follow tuple aliases and array rests.
 * @param includeExternalTypes - Whether tuple aliases may come from external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @returns Candidate element nodes, or `undefined` for non-tuple and unresolved inputs.
 */
export function getTupleLiteralIndexedSourceTypeNodes(
	typeNode: ts.TypeNode,
	index: number,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
): readonly ts.TypeNode[] | undefined {
	const tupleSource = getBoundTupleSourceTypeNode(
		typeNode,
		checker,
		includeExternalTypes,
		substitutions,
	);
	return tupleSource
		? getTupleIndexedElementSourceTypeNodes(
				tupleSource.typeNode,
				index,
				checker,
				includeExternalTypes,
				tupleSource.substitutions,
			)
		: undefined;
}

/**
 * Follows array and readonly-array aliases to their authored element syntax.
 * Generic bindings are extended at each alias so `List<keyof T>[number]`
 * reaches the concrete operator argument instead of the reduced key union.
 */
function getArrayIndexedElementTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration> = new Set(),
): ts.TypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	const unwrapped = unwrapReadonlyContainerTypeNode(substituted, checker, substitutions);
	if (ts.isArrayTypeNode(unwrapped)) {
		return substituteTypeParameterTypeNode(unwrapped.elementType, checker, substitutions);
	}
	if (
		ts.isTypeReferenceNode(unwrapped) &&
		unwrapped.typeArguments?.length === 1 &&
		getBuiltInArrayReferenceName(unwrapped, checker) !== undefined
	) {
		const elementTypeNode = unwrapped.typeArguments?.[0];
		return elementTypeNode
			? substituteTypeParameterTypeNode(elementTypeNode, checker, substitutions)
			: undefined;
	}

	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seenAliases.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}
	const nextSeenAliases = new Set(seenAliases);
	nextSeenAliases.add(declaration);
	const typeArguments =
		ts.isTypeReferenceNode(unwrapped) || ts.isImportTypeNode(unwrapped)
			? unwrapped.typeArguments
			: undefined;
	const aliasSubstitutions = getAliasTypeNodeSubstitutions(
		declaration,
		typeArguments,
		checker,
		substitutions,
	);
	return getArrayIndexedElementTypeNode(
		declaration.type,
		checker,
		includeExternalTypes,
		aliasSubstitutions,
		nextSeenAliases,
	);
}

/**
 * Maps a literal tuple index to the authored elements that can occupy it.
 *
 * Finite tuple spreads are expanded recursively, which handles multiple and
 * nested spreads without relying on TypeScript's compact rest placeholders. An
 * open array rest followed by a suffix returns every element that can slide
 * into the index as the rest length changes.
 *
 * @param tupleTypeNode - Authored tuple whose element is being selected.
 * @param index - Zero-based literal index to locate.
 * @param checker - Checker used to resolve tuple aliases and array rests.
 * @param includeExternalTypes - Whether finite tuple aliases may be external.
 * @param substitutions - Authored substitutions active for this tuple source.
 * @returns Candidate selected elements, or `undefined` for out-of-range or unresolved indexes.
 */
function getTupleIndexedElementSourceTypeNodes(
	tupleTypeNode: ts.TupleTypeNode,
	index: number,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenTupleSources: readonly BoundTupleSourceTypeNode[] = [],
): readonly ts.TypeNode[] | undefined {
	let remainingIndex = index;
	for (const [elementIndex, element] of tupleTypeNode.elements.entries()) {
		const elementSyntax = unwrapTupleElementSyntax(element);
		const elementTypeNode = substituteTypeParameterTypeNode(
			elementSyntax.typeNode,
			checker,
			substitutions,
		);
		if (!elementSyntax.isRest) {
			if (remainingIndex === 0) {
				return [elementTypeNode];
			}
			remainingIndex -= 1;
			continue;
		}

		const tupleSource = getBoundTupleSourceTypeNode(
			elementTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		);
		if (tupleSource) {
			if (hasTupleSourceFrame(seenTupleSources, tupleSource)) {
				return undefined;
			}
			const finiteElements = getFiniteTupleElementSourceTypeNodes(
				tupleSource.typeNode,
				checker,
				includeExternalTypes,
				tupleSource.substitutions,
				[...seenTupleSources, tupleSource],
			);
			if (!finiteElements) {
				return undefined;
			}
			if (remainingIndex < finiteElements.length) {
				return [finiteElements[remainingIndex]!];
			}
			remainingIndex -= finiteElements.length;
			continue;
		}

		const arrayElementTypeNode = getArrayIndexedElementTypeNode(
			elementTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		);
		if (!arrayElementTypeNode) {
			return undefined;
		}
		if (elementIndex === tupleTypeNode.elements.length - 1) {
			return [arrayElementTypeNode];
		}

		// An open rest can be empty or arbitrarily long. At local index N, its
		// element and the first N+1 finite suffix elements are all possible sources.
		const suffixElements = getFiniteTupleElementSourceTypeNodesFromElements(
			tupleTypeNode.elements.slice(elementIndex + 1),
			checker,
			includeExternalTypes,
			substitutions,
			seenTupleSources,
		);
		return suffixElements
			? [arrayElementTypeNode, ...suffixElements.slice(0, remainingIndex + 1)]
			: undefined;
	}

	return undefined;
}

/**
 * Expands an authored tuple into its finite element sources.
 *
 * @param tupleTypeNode - Tuple source to flatten.
 * @param checker - Checker used to follow finite tuple aliases.
 * @param includeExternalTypes - Whether tuple aliases may be external.
 * @param substitutions - Authored substitutions active for this tuple source.
 * @param seenTupleSources - Tuple declarations already visited in the current expansion.
 * @returns Substituted element nodes, or `undefined` when an open or recursive rest is encountered.
 */
function getFiniteTupleElementSourceTypeNodes(
	tupleTypeNode: ts.TupleTypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenTupleSources: readonly BoundTupleSourceTypeNode[],
): readonly ts.TypeNode[] | undefined {
	return getFiniteTupleElementSourceTypeNodesFromElements(
		tupleTypeNode.elements,
		checker,
		includeExternalTypes,
		substitutions,
		seenTupleSources,
	);
}

function getFiniteTupleElementSourceTypeNodesFromElements(
	tupleElements: readonly ts.TypeNode[],
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seenTupleSources: readonly BoundTupleSourceTypeNode[],
): readonly ts.TypeNode[] | undefined {
	const elements: ts.TypeNode[] = [];
	for (const element of tupleElements) {
		const elementSyntax = unwrapTupleElementSyntax(element);
		const elementTypeNode = substituteTypeParameterTypeNode(
			elementSyntax.typeNode,
			checker,
			substitutions,
		);
		if (!elementSyntax.isRest) {
			elements.push(elementTypeNode);
			continue;
		}

		const tupleSource = getBoundTupleSourceTypeNode(
			elementTypeNode,
			checker,
			includeExternalTypes,
			substitutions,
		);
		if (!tupleSource || hasTupleSourceFrame(seenTupleSources, tupleSource)) {
			return undefined;
		}
		const nestedElements = getFiniteTupleElementSourceTypeNodes(
			tupleSource.typeNode,
			checker,
			includeExternalTypes,
			tupleSource.substitutions,
			[...seenTupleSources, tupleSource],
		);
		if (!nestedElements) {
			return undefined;
		}
		elements.push(...nestedElements);
	}

	return elements;
}

/**
 * Detects recursion without conflating separate generic tuple instantiations.
 *
 * A tuple alias reuses one declaration node for every instantiation, so source
 * identity alone incorrectly treats `Spread<Spread<T>>` as a cycle. Binding
 * values are authored nodes; comparing their identities distinguishes nested
 * arguments while recognizing a recursive alias that re-enters with the same
 * effective substitutions.
 *
 * @param seenTupleSources - Tuple source frames already active in this traversal.
 * @param candidate - Newly resolved tuple source frame.
 * @returns Whether the same tuple source and authored bindings are already active.
 */
function hasTupleSourceFrame(
	seenTupleSources: readonly BoundTupleSourceTypeNode[],
	candidate: BoundTupleSourceTypeNode,
): boolean {
	return seenTupleSources.some(
		(seen) =>
			seen.typeNode === candidate.typeNode &&
			areTypeNodeSubstitutionsIdentical(seen.substitutions, candidate.substitutions),
	);
}

function areTypeNodeSubstitutionsIdentical(
	left: Map<ts.Symbol, ts.TypeNode> | undefined,
	right: Map<ts.Symbol, ts.TypeNode> | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	if ((left?.size ?? 0) !== (right?.size ?? 0)) {
		return false;
	}
	return Array.from(left ?? []).every(([symbol, typeNode]) => right?.get(symbol) === typeNode);
}

/**
 * Locates the terminal authored source that contains an indexed-access `keyof`.
 *
 * @param typeNode - Indexed-access syntax whose selected property should be traced.
 * @param checker - Checker used for property and alias resolution.
 * @param includeExternalTypes - Whether tracing may enter external declarations.
 * @param substitutions - Active authored generic substitutions.
 * @param seenIndexedAccesses - Indexed-access syntax already expanded on this path.
 * @returns The terminal syntax containing `keyof`, or `undefined` when none is reachable.
 */
export function getIndexedAccessKeyofSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	substitutions?: Map<ts.Symbol, ts.TypeNode>,
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): ts.TypeNode | undefined {
	const sourceTypeNode = getIndexedAccessSourceTypeNode(
		typeNode,
		checker,
		includeExternalTypes,
		substitutions,
	);
	return sourceTypeNode
		? followTypeAliasToKeyofSource(
				sourceTypeNode,
				checker,
				includeExternalTypes,
				substitutions,
				new Set(),
				seenIndexedAccesses,
			)
		: undefined;
}

/**
 * Selects one unambiguous authored type node for a readable property symbol.
 *
 * Getter annotations take precedence because they define the readable side of
 * an accessor pair. Otherwise every readable declaration must have identical
 * text and an equivalent semantic type; disagreeing merged declarations return
 * `undefined` so source syntax cannot incorrectly override checker semantics.
 * Setter parameters are considered only when no readable declaration exists.
 *
 * @param property - Property symbol whose declarations should be examined.
 * @param checker - Checker used to verify semantic equivalence across declarations.
 * @returns A stable authored property type node, or `undefined` when none is unambiguous.
 */
export function getPropertyTypeNode(
	property: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): ts.TypeNode | undefined {
	const declarations = property?.declarations ?? [];
	const getterTypeNode = declarations.find(
		(declaration): declaration is ts.GetAccessorDeclaration =>
			ts.isGetAccessorDeclaration(declaration) && declaration.type != null,
	)?.type;
	if (getterTypeNode) {
		return getterTypeNode;
	}

	const readableCandidates: ts.TypeNode[] = [];
	let hasUnannotatedReadableDeclaration = false;
	for (const declaration of declarations) {
		if (
			ts.isPropertySignature(declaration) ||
			ts.isPropertyDeclaration(declaration) ||
			ts.isParameter(declaration) ||
			ts.isGetAccessorDeclaration(declaration)
		) {
			if (declaration.type) {
				readableCandidates.push(declaration.type);
			} else {
				hasUnannotatedReadableDeclaration = true;
			}
		}
	}
	if (hasUnannotatedReadableDeclaration) {
		// The checker infers the readable type from the declaration body or
		// initializer. Replaying another declaration's annotation would replace it.
		return undefined;
	}

	const setterCandidates: ts.TypeNode[] = [];
	for (const declaration of declarations) {
		if (ts.isSetAccessorDeclaration(declaration)) {
			const parameterType = declaration.parameters[0]?.type;
			if (parameterType) {
				setterCandidates.push(parameterType);
			}
		}
	}

	const candidates = readableCandidates.length > 0 ? readableCandidates : setterCandidates;
	const first = candidates[0];
	if (!first) {
		return undefined;
	}
	const firstType = checker.getTypeFromTypeNode(first);
	const firstText = first.getText();
	return candidates.every((candidate) => {
		if (candidate.getText() !== firstText) {
			return false;
		}
		const candidateType = checker.getTypeFromTypeNode(candidate);
		return (
			candidateType === firstType || areSemanticTypesEquivalent(candidateType, firstType, checker)
		);
	})
		? first
		: undefined;
}

interface BoundTupleSourceTypeNode {
	typeNode: ts.TupleTypeNode;
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined;
}

/** Bound authored tuple syntax and the generic substitutions active at its declaration. */
export interface BoundTupleTypeNode {
	/** Terminal tuple syntax after following transparent local aliases. */
	typeNode: ts.TupleTypeNode;
	/** Semantic generic bindings accumulated while following aliases. */
	typeParameterSubstitutions: Map<ts.Symbol, ts.Type> | undefined;
	/** Authored generic bindings accumulated while following aliases. */
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined;
	/** Whether a direct or utility wrapper made the terminal tuple readonly. */
	isReadonly: boolean;
}

/**
 * Follows tuple aliases while preserving semantic and authored generic
 * bindings. Readonly wrappers are reported as metadata because callers that
 * perform assignability checks must distinguish readonly-to-mutable tuples.
 *
 * @param typeNode - Authored tuple syntax or alias reference to follow.
 * @param checker - Checker used to resolve aliases and semantic arguments.
 * @param typeParameterSubstitutions - Active semantic generic bindings.
 * @param typeParameterTypeNodeSubstitutions - Active authored generic bindings.
 * @param includeExternalTypes - Whether traversal may enter external aliases.
 * @returns The terminal bound tuple syntax, or `undefined` for unsupported or cyclic sources.
 */
export function getBoundTupleTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
): BoundTupleTypeNode | undefined {
	return followBoundTupleTypeNode(
		typeNode,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
		new Set(),
		false,
	);
}

function getBoundTupleSourceTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): BoundTupleSourceTypeNode | undefined {
	const source = followBoundTupleTypeNode(
		typeNode,
		checker,
		undefined,
		substitutions,
		includeExternalTypes,
		seen,
		false,
	);
	return source
		? {
				typeNode: source.typeNode,
				substitutions: source.typeParameterTypeNodeSubstitutions,
			}
		: undefined;
}

function followBoundTupleTypeNode(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	typeParameterSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes: boolean,
	seenAliases: Set<ts.TypeAliasDeclaration>,
	isReadonly: boolean,
): BoundTupleTypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(
		typeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const parenthesized = unwrapParenthesizedTypeNode(substituted);
	const unwrapped = unwrapReadonlyContainerTypeNode(
		parenthesized,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const terminalIsReadonly = isReadonly || unwrapped !== parenthesized;
	if (ts.isTupleTypeNode(unwrapped)) {
		return {
			typeNode: unwrapped,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
			isReadonly: terminalIsReadonly,
		};
	}
	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seenAliases.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}
	const nextSeenAliases = new Set(seenAliases);
	nextSeenAliases.add(declaration);
	const typeArguments =
		ts.isTypeReferenceNode(unwrapped) || ts.isImportTypeNode(unwrapped)
			? unwrapped.typeArguments
			: undefined;
	const bindings = deriveTypeParameterBindings({
		checker,
		declarations: declaration.typeParameters,
		authoredArguments: typeArguments,
		baseTypes: typeParameterSubstitutions,
		baseTypeNodes: typeParameterTypeNodeSubstitutions,
		useDeclarationDefaults: true,
		substituteArgumentTypes: true,
		bodyForFreshSymbols: declaration.type,
	});
	return followBoundTupleTypeNode(
		declaration.type,
		checker,
		bindings?.types ?? typeParameterSubstitutions,
		bindings?.typeNodes ?? typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
		nextSeenAliases,
		terminalIsReadonly,
	);
}

function followTypeAliasToKeyofSource(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
	substitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
	seenIndexedAccesses: ReadonlySet<ts.IndexedAccessTypeNode> = new Set(),
): ts.TypeNode | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, substitutions);
	if (!includeExternalTypes && hasNodeModulesPathSegment(substituted.getSourceFile())) {
		return undefined;
	}
	const preservableTypeNode = getPreservableKeyofTypeNode(
		substituted,
		checker,
		substitutions,
		includeExternalTypes,
		seenIndexedAccesses,
	);
	if (preservableTypeNode) {
		return preservableTypeNode;
	}

	const unwrapped = unwrapParenthesizedTypeNode(substituted);
	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seen.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}
	seen.add(declaration);
	return followTypeAliasToKeyofSource(
		declaration.type,
		checker,
		includeExternalTypes,
		substitutions,
		seen,
		seenIndexedAccesses,
	);
}

/**
 * Top-level type aliases per source file, keyed by name. Built once per file
 * because this lookup runs for every type reference the checker could not
 * resolve to an alias, and declaration files can hold thousands of statements.
 * Only the first declaration of a name is kept, matching a linear scan.
 */
const localTypeAliasDeclarations = new WeakMap<
	ts.SourceFile,
	Map<string, ts.TypeAliasDeclaration>
>();

function findLocalTypeAliasDeclaration(
	typeNode: ts.TypeReferenceNode,
): ts.TypeAliasDeclaration | undefined {
	if (!ts.isIdentifier(typeNode.typeName)) {
		return undefined;
	}

	const sourceFile = typeNode.getSourceFile();
	let declarations = localTypeAliasDeclarations.get(sourceFile);
	if (!declarations) {
		declarations = new Map();
		for (const statement of sourceFile.statements) {
			if (ts.isTypeAliasDeclaration(statement) && !declarations.has(statement.name.text)) {
				declarations.set(statement.name.text, statement);
			}
		}
		localTypeAliasDeclarations.set(sourceFile, declarations);
	}

	return declarations.get(typeNode.typeName.text);
}

/**
 * Checks whether a type reference is bound by a relative project import.
 *
 * @param typeNode - Authored type reference whose root binding should be inspected.
 * @returns Whether a default, namespace, or named import from a relative module binds the root.
 */
export function isRelativeImportedTypeReference(typeNode: ts.TypeReferenceNode): boolean {
	let rootName = typeNode.typeName;
	while (ts.isQualifiedName(rootName)) {
		rootName = rootName.left;
	}
	if (!ts.isIdentifier(rootName)) {
		return false;
	}

	for (const statement of typeNode.getSourceFile().statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			!statement.moduleSpecifier.text.startsWith('.') ||
			!statement.importClause
		) {
			continue;
		}
		const { importClause } = statement;
		if (importClause.name?.text === rootName.text) {
			return true;
		}
		const bindings = importClause.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === rootName.text) {
			return true;
		}
		if (
			bindings &&
			ts.isNamedImports(bindings) &&
			bindings.elements.some((element) => element.name.text === rootName.text)
		) {
			return true;
		}
	}
	return false;
}
