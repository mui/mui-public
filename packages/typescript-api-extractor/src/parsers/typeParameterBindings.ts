import ts from 'typescript';
import { substituteTypeParameter } from './typeResolvers/mappedTypeSubstitutions';

/** Semantic and authored substitutions for one generic-resolution scope. */
export interface TypeParameterBindings {
	/** Maps every checker symbol for a type parameter to its semantic argument type. */
	types: Map<ts.Symbol, ts.Type>;
	/** Maps the same symbols to authored argument syntax when source fidelity is available. */
	typeNodes?: Map<ts.Symbol, ts.TypeNode>;
}

interface DeriveTypeParameterBindingsOptions {
	/** Checker used to connect declarations, semantic parameters, and authored nodes. */
	checker: ts.TypeChecker;
	/** Authored generic parameter declarations, including optional defaults. */
	declarations?: readonly ts.TypeParameterDeclaration[];
	/** Checker parameter types, which can expose symbols absent from declarations. */
	semanticParameters?: readonly ts.Type[];
	/** Instantiated semantic arguments paired with the parameters by index. */
	semanticArguments?: readonly ts.Type[];
	/** Authored argument nodes paired with the parameters by index. */
	authoredArguments?: readonly ts.TypeNode[];
	/** Existing semantic substitutions to extend. */
	baseTypes?: ReadonlyMap<ts.Symbol, ts.Type>;
	/** Existing authored substitutions to extend. */
	baseTypeNodes?: ReadonlyMap<ts.Symbol, ts.TypeNode>;
	/** Uses declaration defaults when no explicit argument is available. */
	useDeclarationDefaults?: boolean;
	/** Applies bindings accumulated so far to each semantic argument. */
	substituteArgumentTypes?: boolean;
	/** Syntax subtree searched for fresh checker symbols representing the same parameter. */
	bodyForFreshSymbols?: ts.Node;
}

/**
 * Pairs semantic and authored generic arguments with every checker symbol that
 * can represent the corresponding type parameter in a nested resolver.
 *
 * TypeScript can expose distinct symbols for the declaration, its semantic
 * type, and references freshly instantiated inside an alias body. Recording all
 * of them is necessary for nested mapped, conditional, and tuple resolution to
 * see the same active argument.
 *
 * @param options - Sources and policies used to derive the substitution maps.
 * @returns The extended bindings, or `undefined` when no parameter could be bound.
 */
export function deriveTypeParameterBindings(
	options: DeriveTypeParameterBindingsOptions,
): TypeParameterBindings | undefined {
	const {
		checker,
		declarations,
		semanticParameters,
		semanticArguments,
		authoredArguments,
		baseTypes,
		baseTypeNodes,
		useDeclarationDefaults = false,
		substituteArgumentTypes = false,
		bodyForFreshSymbols,
	} = options;
	const count = Math.max(declarations?.length ?? 0, semanticParameters?.length ?? 0);
	if (count === 0) {
		return undefined;
	}

	const types = new Map(baseTypes);
	const typeNodes = new Map(baseTypeNodes);
	let addedBinding = false;
	let addedTypeNode = false;

	for (let index = 0; index < count; index += 1) {
		const declaration = declarations?.[index];
		const semanticParameter = semanticParameters?.[index];
		let argumentNode = authoredArguments?.[index];
		let argumentType = semanticArguments?.[index];

		if (!argumentNode && !argumentType && useDeclarationDefaults) {
			argumentNode = declaration?.default;
		}
		if (!argumentType && argumentNode) {
			argumentType = checker.getTypeFromTypeNode(argumentNode);
		}
		if (!argumentType) {
			continue;
		}
		if (substituteArgumentTypes) {
			argumentType = substituteTypeParameter(argumentType, types);
		}

		const declarationType = declaration ? checker.getTypeAtLocation(declaration) : undefined;
		const declarationSymbol = declaration
			? checker.getSymbolAtLocation(declaration.name)
			: undefined;
		const parameterSymbols = [
			semanticParameter?.symbol,
			declarationType?.symbol,
			declarationSymbol,
		].filter((symbol): symbol is ts.Symbol => symbol != null);
		if (parameterSymbols.length === 0) {
			continue;
		}

		for (const symbol of parameterSymbols) {
			types.set(symbol, argumentType);
			if (argumentNode) {
				typeNodes.set(symbol, argumentNode);
			}
		}
		addedBinding = true;
		addedTypeNode ||= argumentNode != null;

		if (declaration && bodyForFreshSymbols) {
			addFreshTypeParameterSymbols(
				bodyForFreshSymbols,
				declaration,
				parameterSymbols,
				argumentType,
				argumentNode,
				checker,
				types,
				typeNodes,
			);
		}
	}

	return addedBinding ? { types, typeNodes: addedTypeNode ? typeNodes : undefined } : undefined;
}

function addFreshTypeParameterSymbols(
	typeNode: ts.Node,
	declaration: ts.TypeParameterDeclaration,
	parameterSymbols: readonly ts.Symbol[],
	argumentType: ts.Type,
	argumentNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	types: Map<ts.Symbol, ts.Type>,
	typeNodes: Map<ts.Symbol, ts.TypeNode>,
): void {
	const visit = (node: ts.Node): void => {
		const referencedSymbol = ts.isTypeReferenceNode(node)
			? checker.getSymbolAtLocation(node.typeName)
			: undefined;
		const referencesParameter =
			referencedSymbol &&
			(parameterSymbols.includes(referencedSymbol) ||
				referencedSymbol.declarations?.includes(declaration));
		if (ts.isTypeReferenceNode(node) && referencesParameter) {
			const referencedType = checker.getTypeFromTypeNode(node);
			if (referencedType.flags & ts.TypeFlags.TypeParameter && referencedType.symbol) {
				types.set(referencedType.symbol, argumentType);
				if (argumentNode) {
					typeNodes.set(referencedType.symbol, argumentNode);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
}
