import ts from 'typescript';
import {
	IntersectionNode,
	IntrinsicNode,
	LiteralNode,
	ObjectNode,
	TypeOperatorNode,
	TypeQueryNode,
	UnionNode,
	type AnyType,
	type TypeOperatorResolutionKind,
} from '../../models';
import { type ScopedParserContext } from '../../parserContext';
import { getFullNameWithSymbol } from '../common';
import { unwrapTupleElementSyntax } from '../typeContainerUtils';
import { reportUnsupportedTypeFallback } from '../typeResolutionDiagnostics';
import { deriveTypeParameterBindings, type TypeParameterBindings } from '../typeParameterBindings';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { areSemanticTypesEquivalent, getKeyofTypeForOperand } from '../typeResolutionUtils';
import { isExternalTypeNode, resolveExternalType } from './externalTypeResolver';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import { canResolveObjectTypeShallowly, resolveShallowObjectLikeType } from './objectTypeResolver';
import {
	getReferencedInterfaceOrClassDeclaration,
	getReferencedTypeAliasDeclaration,
} from './referencedTypeAlias';
import { resolveTemplateLiteralType } from './templateLiteralTypeResolver';
import {
	containsKeyofTypeOperatorOrAlias,
	containsKeyofTypeOperator,
	flattenIntersectionTypeNodes,
	getBoundTupleTypeNode,
	getIndexedAccessKeyofSourceTypeNode,
	getIndexedAccessSourceTypeNodes,
	getIndexedAccessSourceTypeNode,
	getKeyofTypeOperatorNode,
	getPreservableKeyofTypeNode,
	getTupleLiteralIndexedSourceTypeNodes,
	getTupleNumberIndexedTypeNodes,
	getUniqueSymbolProperty,
	getPropertyTypeNode,
	getSymbolIndexInfo,
	isKeyofReferenceCompoundReplayableInSource,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
} from './typeOperatorTypeNodes';

/**
 * Reconstructs authored `keyof` syntax around TypeScript's reduced semantic result.
 *
 * Concrete `keyof Foo` often reaches the resolver as a literal, intrinsic, or
 * literal union, so this syntax-first resolver must run before broad semantic
 * shape resolvers that would discard the operator.
 *
 * @param request - Semantic result, public name, and authored operator/container syntax.
 * @param session - Active resolution session used for the operand and resolved key set.
 * @returns A type-operator model, a containing union, or `undefined` when no operator applies.
 */
export function resolveTypeOperatorType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	if (
		!session.context.includeExternalTypes &&
		isExternalTypeNode(typeNode, session.context.checker)
	) {
		return undefined;
	}
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	if (!operatorNode) {
		return resolveCollapsedTypeOperatorSyntax(type, typeNode, typeName, session);
	}

	const indexedOperands = getInstantiatedIndexedKeyofOperands(operatorNode.type, session.context);
	const undefinedMember = getUndefinedUnionMember(type);
	const collapsedToUndefined = isUndefinedType(type);
	const operand = indexedOperands
		? indexedOperands.length === 1
			? resolveTypeOperatorOperand(
					indexedOperands[0]!.type,
					indexedOperands[0]!.typeNode ?? operatorNode.type,
					session,
				)
			: new UnionNode(
					undefined,
					indexedOperands.map((indexedOperand) =>
						resolveTypeOperatorOperand(
							indexedOperand.type,
							indexedOperand.typeNode ?? operatorNode.type,
							session,
						),
					),
				)
		: resolveTypeOperatorOperand(
				session.context.checker.getTypeFromTypeNode(operatorNode.type),
				operatorNode.type,
				session,
			);
	let typeOperatorNode: TypeOperatorNode;
	if (session.context.typeOperatorOutput === 'syntaxOnly') {
		typeOperatorNode = new TypeOperatorNode(undefined, 'keyof', operand);
	} else {
		const shouldRecomputeInstantiatedResult =
			session.context.typeParameterSubstitutions?.size && !isConcreteKeyofResultType(type);
		const resultType =
			collapsedToUndefined || shouldRecomputeInstantiatedResult
				? getKeyofResultTypeFromSyntax(operatorNode, session.context)
				: type;
		const resolvedResult = resolveTypeOperatorResult(resultType, session, {
			excludeUndefined: Boolean(undefinedMember),
			typeName: shouldRecomputeInstantiatedResult ? undefined : typeName,
		});
		typeOperatorNode = new TypeOperatorNode(
			undefined,
			'keyof',
			operand,
			resolvedResult.type,
			resolvedResult.resolutionKind,
		);
	}

	if (!undefinedMember && !collapsedToUndefined) {
		return typeOperatorNode;
	}

	return new UnionNode(undefined, [typeOperatorNode, new IntrinsicNode('undefined')]);
}

/**
 * Recomputes the semantic result of authored `keyof` syntax under active substitutions.
 *
 * @param operatorNode - Authored `keyof` node whose operand should be evaluated.
 * @param context - Context containing the checker and semantic substitutions.
 * @returns The substituted key type, falling back to the checker's type for the operator node.
 */
export function getKeyofResultTypeFromSyntax(
	operatorNode: ts.TypeOperatorNode,
	context: ScopedParserContext,
): ts.Type {
	const { checker, typeParameterSubstitutions } = context;
	const operandType = checker.getTypeFromTypeNode(operatorNode.type);
	const indexedOperands = getInstantiatedIndexedKeyofOperands(operatorNode.type, context);
	const substitutedOperand =
		(indexedOperands?.length === 1 ? indexedOperands[0]!.type : undefined) ??
		(typeParameterSubstitutions
			? substituteTypeParameter(operandType, typeParameterSubstitutions)
			: operandType);
	return (
		getKeyofTypeForOperand(checker, substitutedOperand) ?? checker.getTypeFromTypeNode(operatorNode)
	);
}

/**
 * Selects every concrete property from an indexed `keyof` operand after
 * substituting its root object and index parameters. Finite selector unions,
 * broad index signatures, and unique-symbol properties are expanded through
 * public checker APIs; unresolved members abort the replay rather than yielding
 * a partial or `any` operand.
 *
 * @param typeNode - Authored operand proposed as an indexed access.
 * @param context - Active checker and semantic type-parameter bindings.
 * @returns Selected semantic types and authored annotations, or `undefined` when unresolved.
 */
function getInstantiatedIndexedKeyofOperands(
	typeNode: ts.TypeNode,
	context: ScopedParserContext,
): readonly IndexedKeyofOperand[] | undefined {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isIndexedAccessTypeNode(unwrapped) || !context.typeParameterSubstitutions?.size) {
		return undefined;
	}

	const { checker, typeParameterSubstitutions, typeParameterTypeNodeSubstitutions } = context;
	const objectType = substituteTypeParameter(
		checker.getTypeFromTypeNode(unwrapped.objectType),
		typeParameterSubstitutions,
	);
	const authoredIndexTypeNode = substituteTypeParameterTypeNode(
		unwrapped.indexType,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const authoredIndexOperator = getKeyofTypeOperatorNode(authoredIndexTypeNode);
	const indexType = authoredIndexOperator
		? getKeyofResultTypeFromSyntax(authoredIndexOperator, context)
		: substituteTypeParameter(
				checker.getTypeFromTypeNode(unwrapped.indexType),
				typeParameterSubstitutions,
			);
	const selectors = indexType.isUnion() ? indexType.types : [indexType];
	const operands: IndexedKeyofOperand[] = [];
	for (const selector of selectors) {
		const operand = getIndexedKeyofOperand(objectType, selector, checker);
		if (!operand) {
			return undefined;
		}
		if (
			!operands.some((existing) =>
				areSemanticTypesEquivalent(existing.type, operand.type, checker, 'exact'),
			)
		) {
			operands.push(operand);
		}
	}
	return operands.length ? operands : undefined;
}

interface IndexedKeyofOperand {
	type: ts.Type;
	typeNode?: ts.TypeNode;
}

/**
 * Resolves one semantic indexed selector to the selected value type and its
 * authored declaration where available.
 *
 * @param objectType - Instantiated object being indexed.
 * @param selector - One finite or broad semantic selector.
 * @param checker - Checker used for property and index-info lookup.
 * @returns The selected operand, or `undefined` for unsupported selectors.
 */
function getIndexedKeyofOperand(
	objectType: ts.Type,
	selector: ts.Type,
	checker: ts.TypeChecker,
): IndexedKeyofOperand | undefined {
	if (
		selector.flags & ts.TypeFlags.String ||
		selector.flags & ts.TypeFlags.Number ||
		selector.flags & ts.TypeFlags.ESSymbol
	) {
		const indexInfo =
			selector.flags & ts.TypeFlags.ESSymbol
				? getSymbolIndexInfo(objectType, checker)
				: checker.getIndexInfoOfType(
						objectType,
						selector.flags & ts.TypeFlags.String ? ts.IndexKind.String : ts.IndexKind.Number,
					);
		const declaration = indexInfo?.declaration;
		return indexInfo
			? {
					type: indexInfo.type,
					typeNode:
						declaration && ts.isIndexSignatureDeclaration(declaration)
							? declaration.type
							: undefined,
				}
			: undefined;
	}
	const property =
		selector.isStringLiteral() || selector.isNumberLiteral()
			? checker.getPropertyOfType(objectType, String(selector.value))
			: selector.flags & ts.TypeFlags.UniqueESSymbol
				? getUniqueSymbolProperty(objectType, selector, checker)
				: undefined;
	return property
		? {
				type: checker.getTypeOfSymbol(property),
				typeNode: getPropertyTypeNode(property, checker),
			}
		: undefined;
}

function resolveCollapsedTypeOperatorSyntax(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!typeNode) {
		return undefined;
	}

	// TypeScript eagerly reduces operators nested in these containers. Recover
	// the authored branch/property first, then re-enter only syntax-aware
	// resolvers so the reduced semantic type is not mistaken for the whole API.
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isIndexedAccessTypeNode(unwrapped)) {
		const bindings = getIndexedAccessTypeParameterBindings(unwrapped, session);
		const authoredSubstitutions =
			bindings?.typeNodes ?? session.context.typeParameterTypeNodeSubstitutions;
		const indexType = session.context.checker.getTypeFromTypeNode(unwrapped.indexType);
		const resolveSourceMembers = (sourceTypeNodes: readonly ts.TypeNode[]) => {
			const resolveMembers = () =>
				new UnionNode(typeName, [
					...sourceTypeNodes.map((sourceTypeNode) =>
						resolveAuthoredTypeNode(
							substituteTypeParameterTypeNode(
								sourceTypeNode,
								session.context.checker,
								authoredSubstitutions,
							),
							session,
						),
					),
					// Property and tuple source nodes do not retain their optional
					// wrapper. Restore it from the authoritative indexed result.
					...(getUndefinedUnionMember(type) ? [new IntrinsicNode('undefined')] : []),
				]);
			return bindings
				? session.context.runWithTypeParameterSubstitutionScope(
						bindings.types,
						resolveMembers,
						bindings.typeNodes,
					)
				: resolveMembers();
		};
		const indexedSourceTypeNodes = getIndexedAccessSourceTypeNodes(
			unwrapped,
			session.context.checker,
			session.context.includeExternalTypes,
			authoredSubstitutions,
		);
		if (
			indexedSourceTypeNodes &&
			indexedSourceTypeNodes.some((sourceTypeNode) =>
				Boolean(
					getPreservableKeyofTypeNode(
						sourceTypeNode,
						session.context.checker,
						authoredSubstitutions,
						session.context.includeExternalTypes,
					),
				),
			)
		) {
			return resolveSourceMembers(indexedSourceTypeNodes);
		}
		const tupleLiteralTypeNodes = indexType.isNumberLiteral()
			? getTupleLiteralIndexedSourceTypeNodes(
					unwrapped.objectType,
					indexType.value,
					session.context.checker,
					session.context.includeExternalTypes,
					authoredSubstitutions,
				)
			: undefined;
		if (
			tupleLiteralTypeNodes &&
			tupleLiteralTypeNodes.length > 1 &&
			tupleLiteralTypeNodes.some((elementTypeNode) =>
				Boolean(
					getPreservableKeyofTypeNode(
						elementTypeNode,
						session.context.checker,
						authoredSubstitutions,
						session.context.includeExternalTypes,
					),
				),
			)
		) {
			return resolveSourceMembers(tupleLiteralTypeNodes);
		}
		const tupleElementTypeNodes =
			indexType.flags & ts.TypeFlags.Number
				? getTupleNumberIndexedTypeNodes(
						unwrapped.objectType,
						session.context.checker,
						session.context.includeExternalTypes,
						authoredSubstitutions,
					)
				: undefined;
		if (
			tupleElementTypeNodes &&
			(tupleElementTypeNodes.length > 1 || getUndefinedUnionMember(type)) &&
			tupleElementTypeNodes.some((elementTypeNode) =>
				Boolean(
					getPreservableKeyofTypeNode(
						elementTypeNode,
						session.context.checker,
						authoredSubstitutions,
						session.context.includeExternalTypes,
					),
				),
			)
		) {
			return resolveSourceMembers(tupleElementTypeNodes);
		}
		const sourceTypeNode = getIndexedAccessKeyofSourceTypeNode(
			unwrapped,
			session.context.checker,
			session.context.includeExternalTypes,
			authoredSubstitutions,
		);
		if (sourceTypeNode) {
			if (getUndefinedUnionMember(type)) {
				return resolveSourceMembers([sourceTypeNode]);
			}
			// A root `keyof` expression has the same semantic result as the indexed access,
			// so its already-instantiated type is a useful override. A containing wrapper
			// such as `Promise<T>` does not: passing the indexed result as its override would
			// replace the wrapper before its substituted type argument can be resolved.
			const resolveSource = () =>
				resolveAuthoredTypeNode(
					sourceTypeNode,
					session,
					getKeyofTypeOperatorNode(sourceTypeNode) ? type : undefined,
				);
			return bindings
				? session.context.runWithTypeParameterSubstitutionScope(
						bindings.types,
						resolveSource,
						bindings.typeNodes,
					)
				: resolveSource();
		}
	}
	const replaysCompoundReferenceArgument = isKeyofReferenceCompoundReplayableInSource(unwrapped);
	if (
		!replaysCompoundReferenceArgument &&
		!containsKeyofTypeOperatorOrAlias(
			unwrapped,
			session.context.checker,
			new Set(),
			session.context.includeExternalTypes,
		)
	) {
		return undefined;
	}
	if (ts.isUnionTypeNode(unwrapped)) {
		return resolveAuthoredUnion(
			type,
			unwrapped,
			typeName,
			session,
			replaysCompoundReferenceArgument,
		);
	}
	if (ts.isIntersectionTypeNode(unwrapped) && !type.isIntersection()) {
		return resolveAuthoredIntersection(
			unwrapped,
			typeName,
			session,
			replaysCompoundReferenceArgument,
		);
	}
	if (ts.isConditionalTypeNode(unwrapped) && (type.flags & ts.TypeFlags.Conditional) === 0) {
		return resolveCollapsedConditional(type, unwrapped, typeName, session);
	}
	return undefined;
}

/**
 * Derives the generic bindings visible while following an authored indexed access.
 * Nested indexed objects and alias wrappers are traversed so the selected source
 * property can replay the same arguments as the instantiated semantic result.
 *
 * @param typeNode - Authored indexed access whose object supplies generic arguments.
 * @param session - Active resolution session providing checker and outer substitutions.
 * @param baseBindings - Optional bindings accumulated by an enclosing indexed access.
 * @returns The extended semantic and authored bindings, or `undefined` when none apply.
 */
export function getIndexedAccessTypeParameterBindings(
	typeNode: ts.IndexedAccessTypeNode,
	session: TypeResolutionSession,
	baseBindings?: TypeParameterBindings,
): TypeParameterBindings | undefined {
	const { checker, typeParameterSubstitutions, typeParameterTypeNodeSubstitutions } =
		session.context;
	let bindings =
		baseBindings ??
		(typeParameterSubstitutions?.size || typeParameterTypeNodeSubstitutions?.size
			? {
					types: new Map(typeParameterSubstitutions),
					typeNodes: typeParameterTypeNodeSubstitutions
						? new Map(typeParameterTypeNodeSubstitutions)
						: undefined,
				}
			: undefined);
	const authoredObject = unwrapParenthesizedTypeNode(typeNode.objectType);
	if (ts.isIndexedAccessTypeNode(authoredObject)) {
		bindings = getIndexedAccessTypeParameterBindings(authoredObject, session, bindings) ?? bindings;
		const selectedObjectSource = getIndexedAccessSourceTypeNode(
			authoredObject,
			checker,
			session.context.includeExternalTypes,
			bindings?.typeNodes,
		);
		if (selectedObjectSource) {
			bindings =
				getIndexedAccessAliasChainBindings(selectedObjectSource, checker, bindings, new Set()) ??
				bindings;
		}
		return bindings;
	}

	const aliasBindings = getIndexedAccessAliasChainBindings(
		authoredObject,
		checker,
		bindings,
		new Set(),
	);
	if (aliasBindings !== bindings) {
		return aliasBindings;
	}

	const substitutedObject = substituteTypeParameterTypeNode(
		authoredObject,
		checker,
		bindings?.typeNodes,
	);
	const objectType = checker.getTypeFromTypeNode(substitutedObject);
	const reference =
		objectType.flags & ts.TypeFlags.Object && 'target' in objectType
			? (objectType as ts.TypeReference)
			: undefined;
	const authoredArguments =
		ts.isTypeReferenceNode(substitutedObject) || ts.isImportTypeNode(substitutedObject)
			? substitutedObject.typeArguments
			: undefined;
	const semanticParameters = reference
		? (reference.target as ts.GenericType).typeParameters
		: undefined;
	const semanticArguments = reference
		? checker.getTypeArguments(reference)
		: objectType.aliasTypeArguments;
	if (!semanticParameters?.length || !(authoredArguments?.length || semanticArguments?.length)) {
		return bindings;
	}

	return (
		deriveTypeParameterBindings({
			checker,
			semanticParameters,
			semanticArguments,
			authoredArguments,
			baseTypes: bindings?.types,
			baseTypeNodes: bindings?.typeNodes,
			substituteArgumentTypes: true,
		}) ?? bindings
	);
}

/**
 * Accumulates semantic and authored bindings while following generic alias
 * references that wrap the indexed object. Each inner parameter is rebound to
 * the outer argument before the selected tuple/property syntax is resolved.
 */
function getIndexedAccessAliasChainBindings(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	baseBindings: TypeParameterBindings | undefined,
	seenAliases: Set<ts.TypeAliasDeclaration>,
): TypeParameterBindings | undefined {
	const substituted = substituteTypeParameterTypeNode(typeNode, checker, baseBindings?.typeNodes);
	const declaration = getReferencedTypeAliasDeclaration(substituted, checker);
	if (!declaration) {
		const genericDeclaration = getReferencedInterfaceOrClassDeclaration(substituted, checker);
		if (!genericDeclaration?.typeParameters?.length) {
			return baseBindings;
		}
		const typeArguments = ts.isTypeReferenceNode(substituted)
			? substituted.typeArguments
			: ts.isImportTypeNode(substituted)
				? substituted.typeArguments
				: undefined;
		return (
			deriveTypeParameterBindings({
				checker,
				declarations: genericDeclaration.typeParameters,
				authoredArguments: typeArguments,
				baseTypes: baseBindings?.types,
				baseTypeNodes: baseBindings?.typeNodes,
				useDeclarationDefaults: true,
				substituteArgumentTypes: true,
				bodyForFreshSymbols: genericDeclaration,
			}) ?? baseBindings
		);
	}
	if (seenAliases.has(declaration)) {
		return baseBindings;
	}
	const typeArguments =
		ts.isTypeReferenceNode(substituted) || ts.isImportTypeNode(substituted)
			? substituted.typeArguments
			: undefined;
	const bindings =
		deriveTypeParameterBindings({
			checker,
			declarations: declaration.typeParameters,
			authoredArguments: typeArguments,
			baseTypes: baseBindings?.types,
			baseTypeNodes: baseBindings?.typeNodes,
			useDeclarationDefaults: true,
			substituteArgumentTypes: true,
			bodyForFreshSymbols: declaration.type,
		}) ?? baseBindings;
	const nextSeenAliases = new Set(seenAliases);
	nextSeenAliases.add(declaration);
	return getIndexedAccessAliasChainBindings(declaration.type, checker, bindings, nextSeenAliases);
}

function resolveAuthoredUnion(
	type: ts.Type,
	typeNode: ts.UnionTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
	replayActiveReferences = false,
): UnionNode {
	return new UnionNode(
		typeName,
		typeNode.types.map((memberTypeNode) =>
			resolveAuthoredTypeNode(
				memberTypeNode,
				session,
				getCollapsedUnionOperatorResult(type, memberTypeNode, typeNode, session),
				replayActiveReferences,
			),
		),
	);
}

function getCollapsedUnionOperatorResult(
	type: ts.Type,
	memberTypeNode: ts.TypeNode,
	unionTypeNode: ts.UnionTypeNode,
	session: TypeResolutionSession,
): ts.Type | undefined {
	if (
		!session.context.typeParameterSubstitutions?.size ||
		!getKeyofTypeOperatorNode(memberTypeNode) ||
		unionTypeNode.types.filter((member) => getKeyofTypeOperatorNode(member)).length !== 1
	) {
		return undefined;
	}

	// Instantiated unions may retain their pre-canonicalization members only on
	// the private `origin`. When exactly one authored member is `keyof`, the sole
	// concrete non-undefined origin member is its semantic result.
	const origin = (type as ts.Type & { origin?: ts.Type }).origin;
	if (!origin?.isUnion()) {
		return undefined;
	}
	const concreteMembers = origin.types.filter(
		(memberType) => !isUndefinedType(memberType) && isConcreteKeyofResultType(memberType),
	);
	return concreteMembers.length === 1 ? concreteMembers[0] : undefined;
}

function resolveAuthoredIntersection(
	typeNode: ts.IntersectionTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
	replayActiveReferences = false,
): IntersectionNode {
	const memberTypeNodes = flattenIntersectionTypeNodes(typeNode) ?? typeNode.types;
	return new IntersectionNode(
		typeName,
		memberTypeNodes.map((memberTypeNode) =>
			resolveAuthoredTypeNode(memberTypeNode, session, undefined, replayActiveReferences),
		),
		[],
	);
}

function resolveCollapsedConditional(
	type: ts.Type,
	typeNode: ts.ConditionalTypeNode,
	typeName: TypeResolutionRequest['typeName'],
	session: TypeResolutionSession,
): AnyType {
	const { checker } = session.context;
	if (isDistributiveConditionalInstantiation(typeNode, session)) {
		return type.isUnion()
			? new UnionNode(
					typeName,
					type.types.map((memberType) => session.resolve(memberType, undefined)),
				)
			: session.resolve(type, undefined);
	}

	const selectedBranch = getConcreteConditionalBranch(typeNode, session);
	if (selectedBranch) {
		return resolveAuthoredTypeNode(selectedBranch, session, type);
	}

	const trueType = getAuthoredTypeNodeType(typeNode.trueType, session);
	const falseType = getAuthoredTypeNodeType(typeNode.falseType, session);
	const trueMatches = areSemanticTypesEquivalent(type, trueType, checker, 'exact');
	const falseMatches = areSemanticTypesEquivalent(type, falseType, checker, 'exact');
	if (trueMatches && falseMatches) {
		// Once substitution makes both authored branches indistinguishable, their
		// syntax cannot identify which branch TypeScript selected. Keep the already
		// instantiated checker result instead of manufacturing both branches.
		return session.resolve(type, undefined);
	}
	if (trueMatches && !falseMatches) {
		return resolveAuthoredTypeNode(typeNode.trueType, session, type);
	}
	if (falseMatches && !trueMatches) {
		return resolveAuthoredTypeNode(typeNode.falseType, session, type);
	}
	if (isNeverType(falseType) && !isNeverType(type)) {
		return resolveAuthoredTypeNode(typeNode.trueType, session, type);
	}
	if (isNeverType(trueType) && !isNeverType(type)) {
		return resolveAuthoredTypeNode(typeNode.falseType, session, type);
	}
	if (isNeverType(type)) {
		if (isNeverType(falseType)) {
			return resolveAuthoredTypeNode(typeNode.falseType, session, type);
		}
		if (isNeverType(trueType)) {
			return resolveAuthoredTypeNode(typeNode.trueType, session, type);
		}
	}

	return new UnionNode(typeName, [
		resolveAuthoredTypeNode(typeNode.trueType, session),
		resolveAuthoredTypeNode(typeNode.falseType, session),
	]);
}

function resolveAuthoredTypeNode(
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
	typeOverride?: ts.Type,
	replayActiveReference = false,
): AnyType {
	const type = typeOverride ?? getAuthoredTypeNodeType(typeNode, session);
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	const referenceContainsKeyofArgument =
		(ts.isTypeReferenceNode(unwrapped) || ts.isImportTypeNode(unwrapped)) &&
		unwrapped.typeArguments?.some((argument) => containsKeyofTypeOperator(argument));
	if (session.isTypeActive(type) && (referenceContainsKeyofArgument || replayActiveReference)) {
		// Equivalent compound members can share the exact checker identity with
		// their already-active collapsed parent. Dispatching the authored reference
		// directly avoids replacing each recovered member with a shallow cycle
		// placeholder while still scoping its generic bindings for nested members.
		const fullName = getFullNameWithSymbol(type, typeNode, session.context);
		const replayedReference = session.resolveWithSyntax({
			type,
			typeName: fullName?.typeName,
			typeNameSymbol: fullName?.symbol,
			typeNode,
		});
		if (replayedReference) {
			return replayedReference;
		}
	}
	return session.resolveAuthoredSyntax({ type, typeName: undefined, typeNode });
}

function getAuthoredTypeNodeType(typeNode: ts.TypeNode, session: TypeResolutionSession): ts.Type {
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	const authoredType = operatorNode
		? getKeyofResultTypeFromSyntax(operatorNode, session.context)
		: session.context.checker.getTypeFromTypeNode(typeNode);
	return session.context.typeParameterSubstitutions
		? substituteTypeParameter(authoredType, session.context.typeParameterSubstitutions)
		: authoredType;
}

function isDistributiveConditionalInstantiation(
	typeNode: ts.ConditionalTypeNode,
	session: TypeResolutionSession,
): boolean {
	const { checker, typeParameterSubstitutions } = session.context;
	if (!typeParameterSubstitutions?.size) {
		return false;
	}

	const checkType = checker.getTypeFromTypeNode(typeNode.checkType);
	if (!(checkType.flags & ts.TypeFlags.TypeParameter)) {
		return false;
	}

	const substitutedCheckType = substituteTypeParameter(checkType, typeParameterSubstitutions);
	return substitutedCheckType.isUnion() || isNeverType(substitutedCheckType);
}

function getConcreteConditionalBranch(
	typeNode: ts.ConditionalTypeNode,
	session: TypeResolutionSession,
): ts.TypeNode | undefined {
	const {
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
		compilerOptions,
	} = session.context;
	const compositeDecision = getFixedTupleConditionalDecision(
		typeNode.checkType,
		typeNode.extendsType,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
		compilerOptions.strictFunctionTypes ?? compilerOptions.strict ?? false,
	);
	if (compositeDecision != null) {
		return compositeDecision ? typeNode.trueType : typeNode.falseType;
	}
	const strictFunctionTypes =
		compilerOptions.strictFunctionTypes ?? compilerOptions.strict ?? false;
	const rootFunctionDecision = getFunctionConditionalElementDecision(
		typeNode.checkType,
		typeNode.extendsType,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		strictFunctionTypes,
	);
	if (rootFunctionDecision != null) {
		return rootFunctionDecision ? typeNode.trueType : typeNode.falseType;
	}
	const rootIndexDecision = getIndexSignatureConditionalDecision(
		typeNode.checkType,
		typeNode.extendsType,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
	);
	if (rootIndexDecision != null) {
		return rootIndexDecision ? typeNode.trueType : typeNode.falseType;
	}
	const rootObjectDecision = getObjectConditionalDecision(
		typeNode.checkType,
		typeNode.extendsType,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		strictFunctionTypes,
		compilerOptions.exactOptionalPropertyTypes ?? false,
	);
	if (rootObjectDecision != null) {
		return rootObjectDecision ? typeNode.trueType : typeNode.falseType;
	}
	const checkType = getInstantiatedConditionalType(
		typeNode.checkType,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
	);
	const extendsType = getInstantiatedConditionalType(
		typeNode.extendsType,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
	);
	if (!checkType || !extendsType) {
		return undefined;
	}
	const unresolvedFlags =
		ts.TypeFlags.Any |
		ts.TypeFlags.Never |
		ts.TypeFlags.TypeParameter |
		ts.TypeFlags.Conditional |
		ts.TypeFlags.Substitution;
	if (checkType.flags & unresolvedFlags || extendsType.flags & unresolvedFlags) {
		return undefined;
	}

	return getConditionalElementAssignableDecision(checkType, extendsType, checker)
		? typeNode.trueType
		: typeNode.falseType;
}

/**
 * Decides conditional relations between anonymous objects composed entirely of
 * index signatures. A string source covers number keys as TypeScript does;
 * symbol indexes remain a separate key domain. Mixed members return
 * `undefined` so this focused comparator never ignores property requirements.
 *
 * @param checkTypeNode - Authored index-signature object on the left side.
 * @param extendsTypeNode - Authored index-signature object on the right side.
 * @param checker - Checker used for key classification and value assignability.
 * @param substitutions - Active semantic type-parameter bindings.
 * @param typeNodeSubstitutions - Active authored type-parameter bindings.
 * @returns A definite index relation, or `undefined` for other object shapes.
 */
function getIndexSignatureConditionalDecision(
	checkTypeNode: ts.TypeNode,
	extendsTypeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): boolean | undefined {
	const checkObject = unwrapParenthesizedTypeNode(
		substituteTypeParameterTypeNode(checkTypeNode, checker, typeNodeSubstitutions),
	);
	const extendsObject = unwrapParenthesizedTypeNode(
		substituteTypeParameterTypeNode(extendsTypeNode, checker, typeNodeSubstitutions),
	);
	if (!ts.isTypeLiteralNode(checkObject) || !ts.isTypeLiteralNode(extendsObject)) {
		return undefined;
	}
	if (
		!checkObject.members.length ||
		!extendsObject.members.length ||
		!checkObject.members.every(ts.isIndexSignatureDeclaration) ||
		!extendsObject.members.every(ts.isIndexSignatureDeclaration)
	) {
		return undefined;
	}

	const checkIndexes = getConditionalIndexSignatures(
		checkObject.members,
		checker,
		substitutions,
		typeNodeSubstitutions,
	);
	const extendsIndexes = getConditionalIndexSignatures(
		extendsObject.members,
		checker,
		substitutions,
		typeNodeSubstitutions,
	);
	if (!checkIndexes || !extendsIndexes) {
		return undefined;
	}
	for (const target of extendsIndexes) {
		// Prefer a number-specific declaration over the broader string index. A
		// type may legally provide both with a narrower value for numeric keys.
		const source =
			checkIndexes.find((candidate) => candidate.keyKind === target.keyKind) ??
			checkIndexes.find((candidate) => doesIndexKeyCover(candidate.keyKind, target.keyKind));
		if (
			!source ||
			!getConditionalElementAssignableDecision(source.valueType, target.valueType, checker)
		) {
			return false;
		}
	}
	return true;
}

type ConditionalIndexKeyKind = 'string' | 'number' | 'symbol';

interface ConditionalIndexSignature {
	keyKind: ConditionalIndexKeyKind;
	valueType: ts.Type;
}

/**
 * Instantiates authored index declarations into the key/value pairs needed by
 * the structural conditional comparator.
 *
 * @param declarations - Authored index signatures to instantiate.
 * @param checker - Checker used to resolve their key and value types.
 * @param substitutions - Active semantic type-parameter bindings.
 * @param typeNodeSubstitutions - Active authored type-parameter bindings.
 * @returns Instantiated index signatures, or `undefined` for unsupported keys.
 */
function getConditionalIndexSignatures(
	declarations: readonly ts.IndexSignatureDeclaration[],
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): readonly ConditionalIndexSignature[] | undefined {
	const indexes: ConditionalIndexSignature[] = [];
	for (const declaration of declarations) {
		const keyTypeNode = declaration.parameters[0]?.type;
		if (!keyTypeNode || !declaration.type) {
			return undefined;
		}
		const keyType = getInstantiatedConditionalType(
			keyTypeNode,
			checker,
			substitutions,
			typeNodeSubstitutions,
		);
		const valueType = getInstantiatedConditionalType(
			declaration.type,
			checker,
			substitutions,
			typeNodeSubstitutions,
		);
		const keyKind = keyType ? getConditionalIndexKeyKind(keyType) : undefined;
		if (!keyKind || !valueType) {
			return undefined;
		}
		indexes.push({ keyKind, valueType });
	}
	return indexes;
}

function getConditionalIndexKeyKind(type: ts.Type): ConditionalIndexKeyKind | undefined {
	if (type.flags & ts.TypeFlags.String) {
		return 'string';
	}
	if (type.flags & ts.TypeFlags.Number) {
		return 'number';
	}
	return type.flags & ts.TypeFlags.ESSymbol ? 'symbol' : undefined;
}

function doesIndexKeyCover(
	source: ConditionalIndexKeyKind,
	target: ConditionalIndexKeyKind,
): boolean {
	return source === target || (source === 'string' && target === 'number');
}

/**
 * Decides conditional relations between direct anonymous object literals by
 * replaying their property requirements under the active bindings. This keeps
 * TypeScript's structural rule—every required target property must be present
 * and assignable—without cloning its internal anonymous symbols or signatures.
 * Unsupported member shapes return `undefined` so the semantic fallback, not a
 * partial structural guess, owns them.
 *
 * @param checkTypeNode - Authored anonymous object on the conditional's left side.
 * @param extendsTypeNode - Authored anonymous object on the conditional's right side.
 * @param checker - Checker used for member type assignability.
 * @param substitutions - Active semantic type-parameter bindings.
 * @param typeNodeSubstitutions - Active authored type-parameter bindings.
 * @param strictFunctionTypes - Whether callable properties compare parameters contravariantly.
 * @param exactOptionalPropertyTypes - Whether optional targets exclude implicit `undefined`.
 * @returns A definite structural relation, or `undefined` for non-object/unsupported shapes.
 */
function getObjectConditionalDecision(
	checkTypeNode: ts.TypeNode,
	extendsTypeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	strictFunctionTypes: boolean,
	exactOptionalPropertyTypes: boolean,
): boolean | undefined {
	const checkObject = unwrapParenthesizedTypeNode(
		substituteTypeParameterTypeNode(checkTypeNode, checker, typeNodeSubstitutions),
	);
	const extendsObject = unwrapParenthesizedTypeNode(
		substituteTypeParameterTypeNode(extendsTypeNode, checker, typeNodeSubstitutions),
	);
	if (!ts.isTypeLiteralNode(checkObject) || !ts.isTypeLiteralNode(extendsObject)) {
		return undefined;
	}
	if (
		!checkObject.members.every(ts.isPropertySignature) ||
		!extendsObject.members.every(ts.isPropertySignature)
	) {
		return undefined;
	}

	const checkProperties = getConditionalPropertySignatures(checkObject);
	const extendsProperties = getConditionalPropertySignatures(extendsObject);
	if (!checkProperties || !extendsProperties) {
		return undefined;
	}
	for (const [name, extendsProperty] of extendsProperties) {
		const checkProperty = checkProperties.get(name);
		if (!checkProperty) {
			if (extendsProperty.questionToken) {
				continue;
			}
			return false;
		}
		if (checkProperty.questionToken && !extendsProperty.questionToken) {
			return false;
		}

		const functionDecision = getFunctionConditionalElementDecision(
			checkProperty.type!,
			extendsProperty.type!,
			checker,
			substitutions,
			typeNodeSubstitutions,
			substitutions,
			typeNodeSubstitutions,
			strictFunctionTypes,
		);
		if (functionDecision != null) {
			if (!functionDecision) {
				return false;
			}
			continue;
		}

		const checkPropertyType = getInstantiatedConditionalType(
			checkProperty.type!,
			checker,
			substitutions,
			typeNodeSubstitutions,
		);
		const extendsPropertyType = getInstantiatedConditionalType(
			extendsProperty.type!,
			checker,
			substitutions,
			typeNodeSubstitutions,
		);
		if (!checkPropertyType || !extendsPropertyType) {
			return undefined;
		}
		if (
			!isConditionalPropertyTypeAssignable(
				checkPropertyType,
				extendsPropertyType,
				checker,
				Boolean(extendsProperty.questionToken),
				exactOptionalPropertyTypes,
			)
		) {
			return false;
		}
	}
	return true;
}

/**
 * Applies the compiler's implicit-`undefined` rule for optional target
 * properties before delegating ordinary member comparison to the checker.
 * With exact optional properties disabled, every concrete source union member
 * except `undefined` must satisfy the authored target annotation.
 *
 * @param checkType - Instantiated source property type.
 * @param extendsType - Instantiated target property annotation.
 * @param checker - Checker used for ordinary assignability.
 * @param extendsIsOptional - Whether the target property carries `?`.
 * @param exactOptionalPropertyTypes - Whether `?` excludes implicit `undefined`.
 * @returns Whether the source property type satisfies the target property.
 */
function isConditionalPropertyTypeAssignable(
	checkType: ts.Type,
	extendsType: ts.Type,
	checker: ts.TypeChecker,
	extendsIsOptional: boolean,
	exactOptionalPropertyTypes: boolean,
): boolean {
	if (!extendsIsOptional || exactOptionalPropertyTypes) {
		return getConditionalElementAssignableDecision(checkType, extendsType, checker);
	}
	const checkMembers = checkType.isUnion() ? checkType.types : [checkType];
	return checkMembers.every(
		(member) =>
			Boolean(member.flags & ts.TypeFlags.Undefined) ||
			getConditionalElementAssignableDecision(member, extendsType, checker),
	);
}

/**
 * Indexes statically named property signatures and rejects declarations that
 * cannot be compared without the checker's merged-symbol machinery.
 *
 * @param objectNode - Authored anonymous object whose properties are needed.
 * @returns Unique named property signatures, or `undefined` for unsupported declarations.
 */
function getConditionalPropertySignatures(
	objectNode: ts.TypeLiteralNode,
): Map<string, ts.PropertySignature> | undefined {
	const properties = new Map<string, ts.PropertySignature>();
	for (const property of objectNode.members) {
		if (!ts.isPropertySignature(property) || !property.type) {
			return undefined;
		}
		const name = getStaticPropertyName(property.name);
		if (name == null || properties.has(name)) {
			return undefined;
		}
		properties.set(name, property);
	}
	return properties;
}

/**
 * Reads an identifier, string, or numeric property name without evaluating a
 * computed expression.
 *
 * @param name - Authored property name to inspect.
 * @returns Its stable text, or `undefined` for computed/private names.
 */
function getStaticPropertyName(name: ts.PropertyName): string | undefined {
	return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
		? name.text
		: undefined;
}

/**
 * Decides non-distributive fixed-tuple checks after substituting their element
 * parameters. TypeScript exposes `[T]` as an object type, so the root-only
 * semantic substitution used by ordinary conditionals cannot instantiate it.
 * Restricting this fallback to fixed tuples keeps the element-wise
 * assignability test equivalent to the authored tuple relation.
 */
function getFixedTupleConditionalDecision(
	checkTypeNode: ts.TypeNode,
	extendsTypeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes: boolean,
	strictFunctionTypes: boolean,
): boolean | undefined {
	if (!substitutions?.size) {
		return undefined;
	}
	const checkTupleSyntax = getBoundTupleTypeNode(
		checkTypeNode,
		checker,
		substitutions,
		typeNodeSubstitutions,
		includeExternalTypes,
	);
	const extendsTupleSyntax = getBoundTupleTypeNode(
		extendsTypeNode,
		checker,
		substitutions,
		typeNodeSubstitutions,
		includeExternalTypes,
	);
	if (!checkTupleSyntax || !extendsTupleSyntax) {
		return undefined;
	}
	const checkTuple = checkTupleSyntax.typeNode;
	const extendsTuple = extendsTupleSyntax.typeNode;
	if (
		checkTuple.elements.some(isNonFixedTupleElement) ||
		extendsTuple.elements.some(isNonFixedTupleElement)
	) {
		return undefined;
	}
	if (checkTuple.elements.length !== extendsTuple.elements.length) {
		return false;
	}
	if (checkTupleSyntax.isReadonly && !extendsTupleSyntax.isReadonly) {
		return false;
	}

	for (let index = 0; index < checkTuple.elements.length; index += 1) {
		const checkElementNode = unwrapTupleElementSyntax(checkTuple.elements[index]!).typeNode;
		const extendsElementNode = unwrapTupleElementSyntax(extendsTuple.elements[index]!).typeNode;
		const functionDecision = getFunctionConditionalElementDecision(
			checkElementNode,
			extendsElementNode,
			checker,
			checkTupleSyntax.typeParameterSubstitutions,
			checkTupleSyntax.typeParameterTypeNodeSubstitutions,
			extendsTupleSyntax.typeParameterSubstitutions,
			extendsTupleSyntax.typeParameterTypeNodeSubstitutions,
			strictFunctionTypes,
		);
		if (functionDecision != null) {
			if (!functionDecision) {
				return false;
			}
			continue;
		}
		const checkType = getInstantiatedConditionalType(
			checkElementNode,
			checker,
			checkTupleSyntax.typeParameterSubstitutions,
			checkTupleSyntax.typeParameterTypeNodeSubstitutions,
		);
		const extendsType = getInstantiatedConditionalType(
			extendsElementNode,
			checker,
			extendsTupleSyntax.typeParameterSubstitutions,
			extendsTupleSyntax.typeParameterTypeNodeSubstitutions,
		);
		if (!checkType || !extendsType) {
			return undefined;
		}
		const elementDecision = getConditionalElementAssignableDecision(
			checkType,
			extendsType,
			checker,
		);
		if (!elementDecision) {
			return false;
		}
	}
	return true;
}

/**
 * Compares direct function-type tuple elements under their active bindings.
 * Function objects are anonymous semantic types, so TypeScript does not expose
 * reference arguments for the generic-instantiation path below. Comparing
 * their authored parameters contravariantly and returns covariantly preserves
 * the checker relation without cloning internal signature symbols.
 *
 * @param checkTypeNode - Function syntax from the conditional check tuple.
 * @param extendsTypeNode - Function syntax from the conditional extends tuple.
 * @param checker - Checker used for semantic assignability.
 * @param checkSubstitutions - Semantic bindings for the check tuple.
 * @param checkTypeNodeSubstitutions - Authored bindings for the check tuple.
 * @param extendsSubstitutions - Semantic bindings for the extends tuple.
 * @param extendsTypeNodeSubstitutions - Authored bindings for the extends tuple.
 * @param strictFunctionTypes - Whether parameters use contravariant rather than bivariant checking.
 * @returns A definite relation, or `undefined` for non-functions and unsupported signatures.
 */
function getFunctionConditionalElementDecision(
	checkTypeNode: ts.TypeNode,
	extendsTypeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	checkSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	checkTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	extendsSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	extendsTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	strictFunctionTypes: boolean,
): boolean | undefined {
	const checkFunction = unwrapParenthesizedTypeNode(checkTypeNode);
	const extendsFunction = unwrapParenthesizedTypeNode(extendsTypeNode);
	if (!ts.isFunctionTypeNode(checkFunction) || !ts.isFunctionTypeNode(extendsFunction)) {
		return undefined;
	}
	const checkThisParameter = checkFunction.parameters.find(isThisParameter);
	const extendsThisParameter = extendsFunction.parameters.find(isThisParameter);
	const checkParameters = checkFunction.parameters.filter(
		(parameter) => !isThisParameter(parameter),
	);
	const extendsParameters = extendsFunction.parameters.filter(
		(parameter) => !isThisParameter(parameter),
	);
	if (
		checkFunction.typeParameters?.length ||
		extendsFunction.typeParameters?.length ||
		[...checkParameters, ...extendsParameters].some(
			(parameter) => parameter.questionToken || parameter.dotDotDotToken,
		)
	) {
		return undefined;
	}
	if (checkParameters.length > extendsParameters.length) {
		return false;
	}
	if (checkThisParameter?.type && extendsThisParameter?.type) {
		const checkThisType = getInstantiatedConditionalType(
			checkThisParameter.type,
			checker,
			checkSubstitutions,
			checkTypeNodeSubstitutions,
		);
		const extendsThisType = getInstantiatedConditionalType(
			extendsThisParameter.type,
			checker,
			extendsSubstitutions,
			extendsTypeNodeSubstitutions,
		);
		if (
			!checkThisType ||
			!extendsThisType ||
			!getConditionalElementAssignableDecision(extendsThisType, checkThisType, checker)
		) {
			return false;
		}
	}

	for (let index = 0; index < checkParameters.length; index += 1) {
		const checkParameter = checkParameters[index]!;
		const extendsParameter = extendsParameters[index]!;
		if (!checkParameter.type || !extendsParameter.type) {
			return undefined;
		}
		const checkParameterType = getInstantiatedConditionalType(
			checkParameter.type,
			checker,
			checkSubstitutions,
			checkTypeNodeSubstitutions,
		);
		const extendsParameterType = getInstantiatedConditionalType(
			extendsParameter.type,
			checker,
			extendsSubstitutions,
			extendsTypeNodeSubstitutions,
		);
		if (!checkParameterType || !extendsParameterType) {
			return undefined;
		}
		const contravariant = getConditionalElementAssignableDecision(
			extendsParameterType,
			checkParameterType,
			checker,
		);
		const covariant = getConditionalElementAssignableDecision(
			checkParameterType,
			extendsParameterType,
			checker,
		);
		if (strictFunctionTypes ? !contravariant : !contravariant && !covariant) {
			return false;
		}
	}

	const checkReturnType = getInstantiatedConditionalType(
		checkFunction.type,
		checker,
		checkSubstitutions,
		checkTypeNodeSubstitutions,
	);
	const extendsReturnType = getInstantiatedConditionalType(
		extendsFunction.type,
		checker,
		extendsSubstitutions,
		extendsTypeNodeSubstitutions,
	);
	if (extendsReturnType && extendsReturnType.flags & ts.TypeFlags.Void) {
		// TypeScript intentionally accepts a value-returning callback where the
		// target discards its result. Comparing `number` directly with `void`
		// would therefore invert the authored conditional branch.
		return true;
	}
	return checkReturnType && extendsReturnType
		? getConditionalElementAssignableDecision(checkReturnType, extendsReturnType, checker)
		: undefined;
}

/**
 * Identifies TypeScript's explicit `this` pseudo-parameter, which participates
 * in `this` compatibility but not ordinary function arity or parameter order.
 *
 * @param parameter - Authored function parameter to classify.
 * @returns Whether the parameter is the special `this` declaration.
 */
function isThisParameter(parameter: ts.ParameterDeclaration): boolean {
	return ts.isIdentifier(parameter.name) && parameter.name.text === 'this';
}

function getConditionalElementAssignableDecision(
	checkType: ts.Type,
	extendsType: ts.Type,
	checker: ts.TypeChecker,
): boolean {
	if (
		checkType.flags & ts.TypeFlags.Object &&
		extendsType.flags & ts.TypeFlags.Object &&
		(checkType as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference &&
		(extendsType as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
	) {
		const checkReference = checkType as ts.TypeReference;
		const extendsReference = extendsType as ts.TypeReference;
		if (checkReference.target === extendsReference.target) {
			const checkArguments = checker.getTypeArguments(checkReference);
			const extendsArguments = checker.getTypeArguments(extendsReference);
			if (
				checkArguments.length === extendsArguments.length &&
				checkArguments.every(
					(argument, index) =>
						argument === extendsArguments[index] ||
						areSemanticTypesEquivalent(argument, extendsArguments[index]!, checker),
				)
			) {
				return true;
			}
		}
	}
	return checker.isTypeAssignableTo(checkType, extendsType);
}

/**
 * Instantiates a conditional operand using the active generic bindings. This
 * serves both root composite checks and fixed-tuple elements. TypeScript's
 * public checker substitutes bare type parameters but does not expose an API
 * for instantiating a nested `Promise<T>` or `T[]` type. For type references,
 * its assignability engine reads `resolvedTypeArguments`; cloning that internal
 * shape lets the checker retain responsibility for variance and structural
 * compatibility. Unsupported semantic shapes remain unresolved so branch
 * selection never guesses.
 *
 * @param typeNode - Authored conditional operand syntax.
 * @param checker - Checker used to obtain and compare semantic types.
 * @param substitutions - Active semantic generic bindings.
 * @param typeNodeSubstitutions - Active authored generic bindings.
 * @returns The instantiated semantic type, or `undefined` when safe instantiation is unavailable.
 */
function getInstantiatedConditionalType(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): ts.Type | undefined {
	const substitutedTypeNode = substituteTypeParameterTypeNode(
		typeNode,
		checker,
		typeNodeSubstitutions,
	);
	const authoredType = checker.getTypeFromTypeNode(substitutedTypeNode);
	const referencesSubstitution =
		substitutions?.size &&
		typeNodeReferencesSubstitutedParameter(substitutedTypeNode, checker, substitutions);
	const instantiated = instantiateConditionalSemanticType(authoredType, checker, substitutions);
	if (referencesSubstitution && !instantiated.changed) {
		return undefined;
	}
	return containsUnresolvedConditionalType(instantiated.type, checker)
		? undefined
		: instantiated.type;
}

interface InstantiatedConditionalType {
	type: ts.Type;
	changed: boolean;
}

function instantiateConditionalSemanticType(
	type: ts.Type,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type> | undefined,
	seen: Set<ts.Type> = new Set(),
): InstantiatedConditionalType {
	if (!substitutions?.size || seen.has(type)) {
		return { type, changed: false };
	}
	const substituted = substituteTypeParameter(type, substitutions);
	if (substituted !== type) {
		const nested = instantiateConditionalSemanticType(substituted, checker, substitutions, seen);
		return { type: nested.type, changed: true };
	}

	const nextSeen = new Set(seen);
	nextSeen.add(type);
	if (type.isUnionOrIntersection()) {
		const members = type.types.map((member) =>
			instantiateConditionalSemanticType(member, checker, substitutions, nextSeen),
		);
		if (members.some((member) => member.changed)) {
			return {
				type: cloneSemanticType(type, { types: members.map((member) => member.type) }),
				changed: true,
			};
		}
	}

	if (type.flags & ts.TypeFlags.Object) {
		const objectType = type as ts.ObjectType;
		if (objectType.objectFlags & ts.ObjectFlags.Reference) {
			const reference = objectType as ts.TypeReference;
			const arguments_ = checker.getTypeArguments(reference);
			const instantiatedArguments = arguments_.map((argument) =>
				instantiateConditionalSemanticType(argument, checker, substitutions, nextSeen),
			);
			if (instantiatedArguments.some((argument) => argument.changed)) {
				return {
					type: cloneSemanticType(reference, {
						resolvedTypeArguments: instantiatedArguments.map((argument) => argument.type),
						// These caches were resolved against the original type arguments.
						// Clearing them makes the checker rebuild members from the cloned
						// reference target and its instantiated arguments.
						members: undefined,
						properties: undefined,
						callSignatures: undefined,
						constructSignatures: undefined,
						indexInfos: undefined,
					}),
					changed: true,
				};
			}
		}
	}

	return { type, changed: false };
}

let nextConditionalSemanticTypeId = -1;

function cloneSemanticType<T extends ts.Type>(type: T, overrides: object): T {
	// Relation caches are keyed by TypeScript's internal type ID. A clone must
	// not share the uninstantiated source's ID or an earlier generic comparison
	// can be reused for different resolved type arguments.
	const id = nextConditionalSemanticTypeId;
	nextConditionalSemanticTypeId -= 1;
	return Object.assign(Object.create(Object.getPrototypeOf(type)), type, { id }, overrides) as T;
}

function containsUnresolvedConditionalType(
	type: ts.Type,
	checker: ts.TypeChecker,
	seen: Set<ts.Type> = new Set(),
): boolean {
	if (seen.has(type)) {
		return false;
	}
	const unresolvedFlags =
		ts.TypeFlags.TypeParameter | ts.TypeFlags.Conditional | ts.TypeFlags.Substitution;
	if (type.flags & unresolvedFlags) {
		return true;
	}
	const nextSeen = new Set(seen);
	nextSeen.add(type);
	if (type.isUnionOrIntersection()) {
		return type.types.some((member) =>
			containsUnresolvedConditionalType(member, checker, nextSeen),
		);
	}
	if (type.flags & ts.TypeFlags.Object) {
		const objectType = type as ts.ObjectType;
		if (objectType.objectFlags & ts.ObjectFlags.Reference) {
			return checker
				.getTypeArguments(objectType as ts.TypeReference)
				.some((argument) => containsUnresolvedConditionalType(argument, checker, nextSeen));
		}
	}
	return false;
}

function isNonFixedTupleElement(typeNode: ts.TypeNode): boolean {
	return (
		(ts.isNamedTupleMember(typeNode) &&
			(typeNode.dotDotDotToken != null || typeNode.questionToken != null)) ||
		ts.isOptionalTypeNode(typeNode) ||
		ts.isRestTypeNode(typeNode)
	);
}

function typeNodeReferencesSubstitutedParameter(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	substitutions: Map<ts.Symbol, ts.Type>,
): boolean {
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isTypeReferenceNode(node)) {
			const symbol = checker.getSymbolAtLocation(node.typeName);
			if (symbol && substitutions.has(symbol)) {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(typeNode);
	return found;
}

function resolveTypeOperatorOperand(
	type: ts.Type,
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
): AnyType {
	const unwrappedTypeNode = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isTypeQueryNode(unwrappedTypeNode)) {
		return new TypeQueryNode(unwrappedTypeNode.exprName.getText());
	}
	if (ts.isImportTypeNode(unwrappedTypeNode) && unwrappedTypeNode.isTypeOf) {
		return new TypeQueryNode(getImportTypeExpressionText(unwrappedTypeNode));
	}

	if (canResolveObjectTypeShallowly(type, session.context.checker)) {
		if (session.isTypeActive(type)) {
			return compactTypeOperatorOperand(session.resolve(type, typeNode));
		}

		const fullName = getFullNameWithSymbol(type, typeNode, session.context);
		const request: TypeResolutionRequest = {
			type,
			typeNode,
			typeName: fullName?.typeName,
			typeNameSymbol: fullName?.symbol,
		};
		const externalType = resolveExternalType(request, session);
		if (externalType) {
			return externalType;
		}

		const shallowObject = session.runWithTypeFrame(type, () =>
			resolveShallowObjectLikeType(request, session),
		);
		if (shallowObject) {
			return shallowObject;
		}
	}

	return compactTypeOperatorOperand(session.resolve(type, typeNode));
}

/**
 * Extracts the import expression from a `typeof import(...)` type node.
 *
 * The `typeof` keyword and `import` expression are separate AST tokens even
 * when comments or unusual whitespace appear between them. Slicing from the
 * import token avoids interpreting trivia while retaining authored qualifiers,
 * type arguments, and import attributes.
 *
 * @param typeNode - A `typeof import(...)` node whose query expression is needed.
 * @returns The authored text beginning with the `import` keyword.
 */
function getImportTypeExpressionText(typeNode: ts.ImportTypeNode): string {
	const sourceFile = typeNode.getSourceFile();
	const importToken = typeNode
		.getChildren(sourceFile)
		.find((child) => child.kind === ts.SyntaxKind.ImportKeyword);

	if (!importToken) {
		// Valid ImportTypeNodes always contain this token. Keep malformed or synthetic
		// nodes recoverable without reintroducing a whitespace-sensitive assumption.
		return typeNode
			.getText(sourceFile)
			.replace(/^typeof\b/, '')
			.trimStart();
	}

	return sourceFile.text.slice(importToken.getStart(sourceFile), typeNode.getEnd());
}

function resolveTypeOperatorResult(
	type: ts.Type,
	session: TypeResolutionSession,
	options: { excludeUndefined?: boolean; typeName?: TypeResolutionRequest['typeName'] } = {},
): { type: AnyType; resolutionKind: TypeOperatorResolutionKind } {
	if (type.isUnion()) {
		const memberTypes = options.excludeUndefined
			? type.types.filter((memberType) => !isUndefinedType(memberType))
			: type.types;

		if (memberTypes.length === 1) {
			return resolveTypeOperatorResult(memberTypes[0], session, { typeName: options.typeName });
		}
		const resolvedMembers = memberTypes.map((memberType) =>
			resolveTypeOperatorResult(memberType, session),
		);

		return {
			type: new UnionNode(
				options.typeName,
				resolvedMembers.map((member) => member.type),
			),
			resolutionKind: aggregateResolutionKinds(
				resolvedMembers.map((member) => member.resolutionKind),
			),
		};
	}

	const concreteResult = resolveConcreteTypeOperatorResult(type, session, options.typeName);
	if (concreteResult) {
		return { type: concreteResult, resolutionKind: 'exact' };
	}

	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (baseConstraint && baseConstraint !== type) {
		const resolvedConstraint = resolveTypeOperatorResult(baseConstraint, session, {
			typeName: options.typeName,
		});
		return {
			type: resolvedConstraint.type,
			resolutionKind:
				resolvedConstraint.resolutionKind === 'fallback' ? 'fallback' : 'baseConstraint',
		};
	}

	reportUnsupportedTypeFallback(type, undefined, session.context);
	return { type: new IntrinsicNode('any'), resolutionKind: 'fallback' };
}

function aggregateResolutionKinds(
	resolutionKinds: readonly TypeOperatorResolutionKind[],
): TypeOperatorResolutionKind {
	if (resolutionKinds.includes('fallback')) {
		return 'fallback';
	}
	if (resolutionKinds.includes('baseConstraint')) {
		return 'baseConstraint';
	}
	return 'exact';
}

function resolveConcreteTypeOperatorResult(
	type: ts.Type,
	session: TypeResolutionSession,
	typeName: TypeResolutionRequest['typeName'],
): AnyType | undefined {
	if ((type.flags & ts.TypeFlags.Never) !== 0) {
		return new IntrinsicNode('never', typeName);
	}

	if ((type.flags & ts.TypeFlags.String) !== 0) {
		return new IntrinsicNode('string', typeName);
	}

	if ((type.flags & ts.TypeFlags.Number) !== 0) {
		return new IntrinsicNode('number', typeName);
	}

	if ((type.flags & ts.TypeFlags.UniqueESSymbol) !== 0) {
		return session.resolve(type, undefined);
	}

	if ((type.flags & ts.TypeFlags.ESSymbol) !== 0) {
		return new IntrinsicNode('symbol', typeName);
	}

	if (type.isLiteral()) {
		return new LiteralNode(type.isStringLiteral() ? `"${type.value}"` : type.value, typeName);
	}

	// A pattern key such as `data-${string}` is its own base constraint. A template literal
	// that still depends on a type parameter is not, so it resolves through that constraint
	// like any other generic key.
	if (
		(type.flags & ts.TypeFlags.TemplateLiteral) !== 0 &&
		session.context.checker.getBaseConstraintOfType(type) === type
	) {
		return resolveTemplateLiteralType({ type, typeNode: undefined, typeName }, session);
	}

	return undefined;
}

function compactTypeOperatorOperand(type: AnyType): AnyType {
	if (type instanceof ObjectNode && type.typeName) {
		return new ObjectNode(type.typeName, [], undefined, type.indexSignature);
	}

	return type;
}

function getUndefinedUnionMember(type: ts.Type): ts.Type | undefined {
	if (!type.isUnion()) {
		return undefined;
	}

	return type.types.find(isUndefinedType);
}

function isUndefinedType(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.Undefined) !== 0;
}

function isNeverType(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.Never) !== 0;
}

function isConcreteKeyofResultType(type: ts.Type): boolean {
	if (type.isUnion()) {
		return type.types.every(
			(memberType) => isUndefinedType(memberType) || isConcreteKeyofResultType(memberType),
		);
	}

	return (
		(type.flags &
			(ts.TypeFlags.String |
				ts.TypeFlags.Number |
				ts.TypeFlags.ESSymbol |
				ts.TypeFlags.UniqueESSymbol |
				ts.TypeFlags.Literal |
				ts.TypeFlags.Never)) !==
		0
	);
}
