import ts from 'typescript';
import { type AnyType, UnionNode } from '../../models';
import { type ScopedParserContext } from '../../parserContext';
import { TypeName } from '../../models/typeName';
import { deriveTypeParameterBindings, type TypeParameterBindings } from '../typeParameterBindings';
import {
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession,
} from '../typeResolutionTypes';
import { areSemanticTypesEquivalent } from '../typeResolutionUtils';
import {
	containsKeyofTypeOperatorOrAlias,
	getIndexedAccessSourceTypeNode,
	getKeyofTypeOperatorNode,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
} from './typeOperatorTypeNodes';
import {
	getIndexedAccessTypeParameterBindings,
	getKeyofResultTypeFromSyntax,
} from './typeOperatorTypeResolver';
import { getReferencedTypeAliasDeclaration } from './referencedTypeAlias';

/**
 * Resolves unions while preserving authored member order and source-only operator syntax.
 *
 * @param request - Semantic union candidate, public name, and optional authored union syntax.
 * @param session - Active resolution session used for union members and alias substitutions.
 * @returns A union-derived model, otherwise `undefined` for non-union types.
 */
export function resolveUnionTypeNode(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	if (!type.isUnion()) {
		return undefined;
	}

	return resolveUnionType(type, typeName, typeNode, session);
}

interface AuthoredUnionMember {
	typeNode: ts.TypeNode;
	bindings?: TypeParameterBindings;
	orderOnly: boolean;
}

interface AuthoredUnionSource {
	typeNode: ts.UnionTypeNode;
	bindings?: TypeParameterBindings;
	orderOnly: boolean;
}

/**
 * Flattens nested union TypeNodes to match how TypeScript flattens Types.
 * For example: `(string | ((state: State) => string | undefined)) | undefined`
 * The TypeNode has 2 members but TypeScript flattens the Types to 3 members.
 * This function recursively flattens nested unions while unwrapping parenthesized types.
 *
 * Also handles indexed access types (e.g., `Foo['bar']`) whose resolved type is a union:
 * it follows the declaration chain to find the source-ordered union TypeNode and flattens
 * its members in place. Named type references are intentionally not expanded.
 */
function flattenUnionTypeNode(
	typeNode: ts.UnionTypeNode,
	session: TypeResolutionSession,
	bindings?: TypeParameterBindings,
	orderOnly = false,
): AuthoredUnionMember[] {
	const result: AuthoredUnionMember[] = [];

	for (const member of typeNode.types) {
		// Unwrap parenthesized types like `(string | number)`
		const unwrapped = unwrapParenthesizedTypeNode(member);

		// If the unwrapped type is a union, recursively flatten it
		if (ts.isUnionTypeNode(unwrapped)) {
			result.push(...flattenUnionTypeNode(unwrapped, session, bindings, orderOnly));
		} else {
			// Check if this non-union TypeNode resolves to a union type.
			// This currently handles indexed access types (e.g., `Foo['bar']`) whose
			// resolved type is a union. We follow the declaration to find the source-ordered
			// union TypeNode and flatten its members to preserve authored order.
			const underlyingUnion = resolveToUnionTypeNode(unwrapped, session, bindings);
			if (underlyingUnion) {
				result.push(
					...flattenUnionTypeNode(
						underlyingUnion.typeNode,
						session,
						underlyingUnion.bindings,
						underlyingUnion.orderOnly,
					),
				);
			} else {
				result.push({ typeNode: unwrapped, bindings, orderOnly });
			}
		}
	}

	return result;
}

/**
 * Attempts to resolve a non-union TypeNode to its underlying union TypeNode
 * by following the declaration chain. This preserves the source order of union members.
 *
 * Only handles indexed access types: `Foo['bar']` -> finds `bar`'s declaration TypeNode.
 * Named type references (like `MyAlias`) are intentionally NOT expanded, since they
 * represent authored aliases that should be preserved.
 */
function resolveToUnionTypeNode(
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
	baseBindings?: TypeParameterBindings,
): AuthoredUnionSource | undefined {
	const { checker, includeExternalTypes } = session.context;
	// Only resolve if the type actually resolves to a union
	const resolvedType = checker.getTypeFromTypeNode(typeNode);
	if (!resolvedType.isUnion()) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	const bindings = ts.isIndexedAccessTypeNode(unwrapped)
		? (getIndexedAccessTypeParameterBindings(unwrapped, session, baseBindings) ?? baseBindings)
		: baseBindings;
	let sourceTypeNode = getIndexedAccessSourceTypeNode(
		typeNode,
		checker,
		includeExternalTypes,
		bindings?.typeNodes,
	);
	let orderOnly = false;
	if (!sourceTypeNode && !includeExternalTypes) {
		// Plain external unions may supply order for members already present in the
		// semantic result without exposing an external model. The order-only marker
		// also lets operator members consume their semantic keys at the authored
		// position without replaying external syntax or attaching resolved payloads.
		const externalSourceTypeNode = getIndexedAccessSourceTypeNode(
			typeNode,
			checker,
			true,
			bindings?.typeNodes,
		);
		if (externalSourceTypeNode) {
			sourceTypeNode = externalSourceTypeNode;
			orderOnly = true;
		}
	}
	const unwrappedSource = sourceTypeNode ? unwrapParenthesizedTypeNode(sourceTypeNode) : undefined;
	return unwrappedSource && ts.isUnionTypeNode(unwrappedSource)
		? { typeNode: unwrappedSource, bindings, orderOnly }
		: undefined;
}

function resolveUnionType(
	type: ts.UnionType,
	typeName: TypeName | undefined,
	typeNode: ts.TypeNode | undefined,
	session: TypeResolutionSession,
	aliasSubstitutionsApplied = false,
): AnyType {
	const { context } = session;
	const resolve = session.resolveWithContext;
	const { checker } = context;
	if (typeNode) {
		typeNode = unwrapParenthesizedTypeNode(typeNode);
	}

	let memberTypes: ts.Type[] = type.types;
	const result: AnyType[] = [];

	// @ts-expect-error - Internal API
	if (type.origin?.isUnion()) {
		// If a union type contains another union, `type.types` will contain the flattened types.
		// To resolve the original union type, we need to use the internal `type.origin.types`.
		// For example, given the types:
		// type U1 = string | number;
		// type U2 = U1 | boolean;
		// The `type.types` will contain [string, number, boolean], but we
		// need to resolve the original union type [U1, boolean] to get the correct type nodes.
		// `type.origin.types` will contain [U1, boolean].

		// @ts-expect-error - Internal API
		memberTypes = type.origin.types;
	}

	// If there's no provided type node or it's is not a union,
	// We check if the type declaration is an alias.
	// If so, it can point to the original union type.
	//
	// For example:
	// function f(x: Params) {}
	// type Params = SomeType | SomeOtherType;
	//
	// In this case `typeNode` will be set to the type reference of the function parameter,
	// so we extract the needed union definition.
	const unionAlias = getAuthoredUnionAlias(type, typeNode, checker);
	let rootUnionSource: AuthoredUnionSource | undefined;
	if ((!typeNode || !ts.isUnionTypeNode(typeNode)) && unionAlias) {
		typeNode = unionAlias.declaration.type;
	} else if (typeNode && !ts.isUnionTypeNode(typeNode)) {
		rootUnionSource = resolveToUnionTypeNode(typeNode, session);
		if (rootUnionSource) {
			typeNode = rootUnionSource.typeNode;
		}
	}

	const aliasSubstitutions = getAliasTypeParameterSubstitutions(
		unionAlias?.declaration,
		unionAlias?.typeArguments,
		context,
	);
	if (!aliasSubstitutionsApplied && aliasSubstitutions) {
		return context.runWithTypeParameterSubstitutionScope(aliasSubstitutions, () =>
			resolveUnionType(type, typeName, typeNode, session, true),
		);
	}

	if (typeNode && ts.isUnionTypeNode(typeNode)) {
		// Match union member types with TypeNodes (what TS resolves to what was authored in code).
		// This is necessary as TS takes shortcuts when resolving types and drops information
		// about simple aliases like `type Foo = Bar;` (it behaves like `Bar` doesn't exist).
		//
		// A TypeNode is considered a match for a memberType if:
		// - The TypeNode resolves to the same Type as `memberType`. This is the simplest case.
		// - The `memberType` is a closed generic of type represented by TypeNode.
		//   For example, memberType = `Array<string>` and TypeNode = `Array<T>`.

		// Flatten nested unions in the TypeNode to match how TypeScript flattens the Types
		const flattenedTypeNodes = flattenUnionTypeNode(
			typeNode,
			session,
			rootUnionSource?.bindings,
			rootUnionSource?.orderOnly,
		);

		// Match each TypeNode to a memberType and resolve in source order
		const usedMemberTypes = new Set<ts.Type>();

		for (const { typeNode: authoredNode, bindings, orderOnly } of flattenedTypeNodes) {
			const node = substituteTypeParameterTypeNode(
				authoredNode,
				checker,
				bindings?.typeNodes ?? context.typeParameterTypeNodeSubstitutions,
			);
			const operatorNode = getKeyofTypeOperatorNode(node);
			const nodeType = operatorNode
				? getKeyofResultTypeFromSyntax(operatorNode, context)
				: checker.getTypeFromTypeNode(node);
			if (
				orderOnly &&
				node === authoredNode &&
				containsKeyofTypeOperatorOrAlias(node, checker, new Set(), true, bindings?.typeNodes)
			) {
				const orderedMembers = resolveOrderOnlyCompositeMembers(
					nodeType,
					memberTypes,
					type.types,
					usedMemberTypes,
					context,
					resolve,
				);
				if (orderedMembers) {
					result.push(...orderedMembers);
					continue;
				}
			}
			const substitutedUnionMember =
				node !== authoredNode
					? resolveSubstitutedUnionMember(
							node,
							nodeType,
							memberTypes,
							type.types,
							usedMemberTypes,
							context,
							resolve,
						)
					: undefined;
			if (substitutedUnionMember) {
				result.push(substitutedUnionMember);
				continue;
			}
			const preservedCompositeMember = resolvePreservedCompositeMember(
				node,
				nodeType,
				memberTypes,
				type.types,
				usedMemberTypes,
				context,
				resolve,
			);
			if (preservedCompositeMember) {
				result.push(preservedCompositeMember);
				continue;
			}
			if (
				nodeType.flags & ts.TypeFlags.Never &&
				containsKeyofTypeOperatorOrAlias(node, checker, new Set(), context.includeExternalTypes)
			) {
				result.push(resolve(nodeType, node, context));
				continue;
			}

			// Special case: boolean TypeNode matches both false and true literal types
			// TypeScript expands `boolean` to `false | true` in union types
			// We need to mark ALL boolean literals as used since they correspond to a single boolean TypeNode
			const isBooleanNode = (nodeType.flags & ts.TypeFlags.Boolean) !== 0;

			if (isBooleanNode) {
				// Mark all boolean literal memberTypes as used
				let foundBooleanLiteral = false;
				for (const memberType of memberTypes) {
					if ((memberType.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
						usedMemberTypes.add(memberType);
						foundBooleanLiteral = true;
					}
				}
				if (foundBooleanLiteral) {
					// Resolve as the boolean TypeNode (not the individual literals)
					result.push(resolve(nodeType, node, context));
					continue;
				}
			}

			// Find a matching memberType for this TypeNode
			let matchedMemberType: ts.Type | undefined;

			for (const memberType of memberTypes) {
				if (usedMemberTypes.has(memberType)) {
					continue;
				}

				// Check for direct match or closed generic
				if (memberType === nodeType || isClosedGeneric(memberType, nodeType)) {
					matchedMemberType = memberType;
					break;
				}
			}

			if (matchedMemberType) {
				usedMemberTypes.add(matchedMemberType);
				result.push(resolve(matchedMemberType, node, context));
			}
			// If no matching memberType found, skip this TypeNode.
			// The unmatched memberType will be added at the end.
		}

		// Add any memberTypes that weren't matched to a TypeNode
		// This handles cases like optional properties where TypeScript adds `undefined`
		// to the union but there's no corresponding TypeNode for it
		for (const memberType of memberTypes) {
			if (!usedMemberTypes.has(memberType)) {
				result.push(resolve(memberType, undefined, context));
			}
		}
	} else {
		// Type is an union type, but TypeNode is not.
		// This can happen for optional properties: `foo?: T` is resolved as `T | undefined`.
		if (
			memberTypes.length === 2 &&
			memberTypes.some((x) => x.flags & ts.TypeFlags.Undefined) &&
			typeNode &&
			(ts.isTypeReferenceNode(typeNode) || ts.isImportTypeNode(typeNode))
		) {
			// In such case propagate the parent TypeNode to the member types.
			// It will help to resolve T correctly and won't have any effect on the `undefined` type.
			for (const memberType of memberTypes) {
				result.push(resolve(memberType, typeNode, context));
			}
		} else {
			for (const memberType of memberTypes) {
				result.push(resolve(memberType, undefined, context));
			}
		}
	}

	const typeNameToUse = typeName?.name ? typeName : undefined;

	return result.length === 1 ? result[0] : new UnionNode(typeNameToUse, result);
}

function getAliasTypeParameterSubstitutions(
	declaration: ts.TypeAliasDeclaration | undefined,
	typeArguments: readonly ts.Type[] | undefined,
	context: ScopedParserContext,
): Map<ts.Symbol, ts.Type> | undefined {
	if (!declaration || !declaration.typeParameters?.length || !typeArguments?.length) {
		return undefined;
	}

	return deriveTypeParameterBindings({
		checker: context.checker,
		declarations: declaration.typeParameters,
		semanticArguments: typeArguments,
		baseTypes: context.typeParameterSubstitutions,
	})?.types;
}

function getAuthoredUnionAlias(
	type: ts.UnionType,
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): { declaration: ts.TypeAliasDeclaration; typeArguments?: readonly ts.Type[] } | undefined {
	const semanticDeclaration = type.aliasSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
	if (semanticDeclaration && ts.isUnionTypeNode(semanticDeclaration.type)) {
		return { declaration: semanticDeclaration, typeArguments: type.aliasTypeArguments };
	}

	const unwrappedTypeNode = typeNode ? unwrapParenthesizedTypeNode(typeNode) : undefined;
	const declaration = getReferencedTypeAliasDeclaration(unwrappedTypeNode, checker);
	if (!declaration || !ts.isUnionTypeNode(declaration.type)) {
		return undefined;
	}
	const typeArguments =
		unwrappedTypeNode &&
		(ts.isTypeReferenceNode(unwrappedTypeNode) || ts.isImportTypeNode(unwrappedTypeNode))
			? unwrappedTypeNode.typeArguments
			: undefined;

	return {
		declaration,
		typeArguments: typeArguments?.map((argument) => checker.getTypeFromTypeNode(argument)),
	};
}

function isClosedGeneric(type1: ts.Type, type2: ts.Type): boolean {
	if (!('target' in type1)) {
		return false;
	}

	return type1.target === type2 || ('target' in type2 && type1.target === type2.target);
}

function resolveSubstitutedUnionMember(
	typeNode: ts.TypeNode,
	nodeType: ts.Type,
	memberTypes: readonly ts.Type[],
	normalizedMemberTypes: readonly ts.Type[],
	usedMemberTypes: Set<ts.Type>,
	context: ScopedParserContext,
	resolve: ResolveTypeInContext,
): AnyType | undefined {
	if (
		!nodeType.isUnion() ||
		!selectCompositeMemberTypes(
			nodeType,
			memberTypes,
			normalizedMemberTypes,
			usedMemberTypes,
			context.checker,
		)
	) {
		return undefined;
	}

	// A generic argument can resolve to a union even when its syntax is an indexed
	// access, conditional, or alias. Resolve that authored argument as one
	// composite at the parameter's position after claiming its flattened semantic
	// members from the containing union.
	return resolve(nodeType, typeNode, context);
}

function resolveOrderOnlyCompositeMembers(
	nodeType: ts.Type,
	memberTypes: readonly ts.Type[],
	normalizedMemberTypes: readonly ts.Type[],
	usedMemberTypes: Set<ts.Type>,
	context: ScopedParserContext,
	resolve: ResolveTypeInContext,
): AnyType[] | undefined {
	const selectedTypes = selectCompositeMemberTypes(
		nodeType,
		memberTypes,
		normalizedMemberTypes,
		usedMemberTypes,
		context.checker,
	);
	if (!selectedTypes) {
		return undefined;
	}

	// External syntax supplies placement only. Resolving the already-selected
	// semantic members without that node keeps operator payloads opaque while
	// retaining the authored composite's position in the surrounding union.
	return selectedTypes.map((memberType) => resolve(memberType, undefined, context));
}

function resolvePreservedCompositeMember(
	typeNode: ts.TypeNode,
	nodeType: ts.Type,
	memberTypes: readonly ts.Type[],
	normalizedMemberTypes: readonly ts.Type[],
	usedMemberTypes: Set<ts.Type>,
	context: ScopedParserContext,
	resolve: ResolveTypeInContext,
): AnyType | undefined {
	if (
		!containsKeyofTypeOperatorOrAlias(
			typeNode,
			context.checker,
			new Set(),
			context.includeExternalTypes,
		)
	) {
		return undefined;
	}
	if (
		!selectCompositeMemberTypes(
			nodeType,
			memberTypes,
			normalizedMemberTypes,
			usedMemberTypes,
			context.checker,
		)
	) {
		return undefined;
	}

	return resolve(nodeType, typeNode, context);
}

function selectCompositeMemberTypes(
	nodeType: ts.Type,
	memberTypes: readonly ts.Type[],
	normalizedMemberTypes: readonly ts.Type[],
	usedMemberTypes: Set<ts.Type>,
	checker: ts.TypeChecker,
): ts.Type[] | undefined {
	const unionMembers = nodeType.isUnion() ? new Set(nodeType.types) : undefined;
	const containsMember = (memberType: ts.Type) =>
		unionMembers
			? unionMembers.has(memberType)
			: areSemanticTypesEquivalent(nodeType, memberType, checker);

	// `memberTypes` may come from TypeScript's union origin and omit an authored
	// subset such as `keyof Narrow`. Validate against the normalized union instead.
	if (!normalizedMemberTypes.some(containsMember)) {
		return undefined;
	}

	const selectedTypes: ts.Type[] = [];
	for (const memberType of memberTypes) {
		const covered = memberType.isUnion()
			? areSemanticTypesEquivalent(nodeType, memberType, checker)
			: containsMember(memberType);
		if (!covered) {
			continue;
		}

		usedMemberTypes.add(memberType);
		selectedTypes.push(memberType);
	}

	return selectedTypes.length > 0 ? selectedTypes : undefined;
}
