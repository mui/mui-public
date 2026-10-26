import ts from 'typescript';
import { IntrinsicNode, TypeParameterNode, UnionNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { hasExactFlag } from '../typeResolutionUtils';
import {
	containsKeyofTypeOperator,
	containsKeyofTypeOperatorOrAlias,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
} from './typeOperatorTypeNodes';

// Special resolvers cover TypeScript-internal or context-sensitive
// shapes that do not map directly to one public model node. They either
// substitute a more concrete type, or intentionally fall back to `any` for
// unsupported internals.

/**
 * Resolves a bare type parameter `T`. Prefers an active substitution, then a
 * concrete type recovered from the authored `typeNode`, and otherwise emits a
 * TypeParameterNode carrying the parameter's constraint and default.
 */
export function resolveTypeParameterType(
	{ type, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { checker, typeParameterSubstitutions } = session.context;

	if (!hasExactFlag(type, ts.TypeFlags.TypeParameter) || !type.symbol) {
		return undefined;
	}

	const substitution = typeParameterSubstitutions?.get(type.symbol);
	if (
		substitution &&
		substitution !== type &&
		(!(substitution.flags & ts.TypeFlags.TypeParameter) || substitution.symbol !== type.symbol)
	) {
		const directTypeNodeSubstitution = session.context.typeParameterTypeNodeSubstitutions?.get(
			type.symbol,
		);
		const substitutedTypeNode = typeNode
			? substituteTypeParameterTypeNode(
					typeNode,
					checker,
					session.context.typeParameterTypeNodeSubstitutions,
				)
			: directTypeNodeSubstitution;
		const shouldCarrySubstitutionSyntax =
			substitutedTypeNode != null &&
			(containsKeyofTypeOperator(substitutedTypeNode) || isKeyofOperandTypeNode(typeNode));
		return session.resolve(
			substitution,
			shouldCarrySubstitutionSyntax
				? substitutedTypeNode !== typeNode
					? substitutedTypeNode
					: directTypeNodeSubstitution
				: undefined,
		);
	}

	// If we have a typeNode, check if it resolves to a more concrete type than the TypeParameter.
	// This handles cases where TypeScript doesn't fully instantiate generic parameters,
	// but the typeNode (authored code) references the actual concrete type.
	if (typeNode && ts.isTypeReferenceNode(typeNode)) {
		const symbol = checker.getSymbolAtLocation(typeNode.typeName);
		if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
			const symbolType = checker.getDeclaredTypeOfSymbol(symbol);
			if (symbolType && !hasExactFlag(symbolType, ts.TypeFlags.TypeParameter)) {
				return session.resolve(symbolType, typeNode);
			}
		}
	}

	const declaration = type.symbol.declarations?.[0] as ts.TypeParameterDeclaration | undefined;
	let constraint: AnyType | undefined;
	if (declaration?.constraint) {
		const shouldPreserveConstraintSyntax = containsKeyofTypeOperatorOrAlias(
			declaration.constraint,
			checker,
			new Set(),
			session.context.includeExternalTypes,
		);
		const constraintType = shouldPreserveConstraintSyntax
			? checker.getTypeAtLocation(declaration.constraint)
			: checker.getBaseConstraintOfType(type);

		constraint = constraintType
			? session.resolve(
					constraintType,
					shouldPreserveConstraintSyntax ? declaration.constraint : undefined,
				)
			: undefined;
	}

	return new TypeParameterNode(
		type.symbol.name,
		constraint,
		declaration?.default
			? session.resolve(
					checker.getTypeAtLocation(declaration.default),
					containsKeyofTypeOperatorOrAlias(
						declaration.default,
						checker,
						new Set(),
						session.context.includeExternalTypes,
					)
						? declaration.default
						: undefined,
				)
			: undefined,
	);
}

function isKeyofOperandTypeNode(typeNode: ts.TypeNode | undefined): boolean {
	let current = typeNode;
	while (current?.parent && ts.isParenthesizedTypeNode(current.parent)) {
		current = current.parent;
	}
	return Boolean(
		current?.parent &&
		ts.isTypeOperatorNode(current.parent) &&
		current.parent.operator === ts.SyntaxKind.KeyOfKeyword,
	);
}

/**
 * Resolves TypeScript's built-in `Extract<T, U>` utility over an index-like
 * check type (`Extract<keyof T, string>`, `Extract<T[K], string>`) through the
 * base constraint computed by the checker. For those inputs, TypeScript exposes
 * the true branch as a narrowing intersection (for example,
 * `string & keyof T`), while the base constraint is the representable result
 * bound (`string` in that example).
 *
 * The shortcut is deliberately limited to index-like check types, which
 * `resolveIndexLikeType` already collapses to their base constraint, so the
 * genericity lost here would have been lost anyway. `Extract` over a naked type
 * parameter is exactly that parameter (`Extract<T, string>` with
 * `T extends string` is `T`), and the conditional fallback keeps it as a
 * TypeParameterNode, so those must not take this path.
 */
export function resolveExtractUtilityType(
	{ type }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!hasExactFlag(type, ts.TypeFlags.Conditional)) {
		return undefined;
	}

	const conditionalType = type as ts.ConditionalType;
	if (
		!isBuiltInExtractSymbol(conditionalType.root.aliasSymbol) ||
		!isIndexLikeType(conditionalType.checkType)
	) {
		return undefined;
	}

	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (!baseConstraint || baseConstraint === type) {
		return undefined;
	}

	return session.resolve(baseConstraint, undefined);
}

function isIndexLikeType(type: ts.Type): boolean {
	return hasExactFlag(type, ts.TypeFlags.Index) || hasExactFlag(type, ts.TypeFlags.IndexedAccess);
}

function isBuiltInExtractSymbol(symbol: ts.Symbol | undefined): boolean {
	return (
		symbol?.getName() === 'Extract' &&
		symbol.declarations?.some((declaration) =>
			/[\\/]typescript[\\/]lib[\\/]lib\.[^\\/]+\.d\.ts$/.test(declaration.getSourceFile().fileName),
		) === true
	);
}

/**
 * Resolves a conditional type `T extends X ? A : B`. Since the parser cannot
 * evaluate the condition in the general case, it emits both resolved branches as
 * a union (or the single branch TypeScript managed to resolve).
 */
export function resolveConditionalType(
	{ type, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!hasExactFlag(type, ts.TypeFlags.Conditional)) {
		return undefined;
	}

	const conditionalType = type as ts.ConditionalType;
	const conditionalTypeNode = getConditionalTypeNode(typeNode);
	const trueTypeNode = conditionalTypeNode?.trueType;
	const falseTypeNode = conditionalTypeNode?.falseType;
	const preservableBranchTypeNode = (branchTypeNode: ts.TypeNode | undefined) =>
		containsKeyofTypeOperatorOrAlias(
			branchTypeNode,
			session.context.checker,
			new Set(),
			session.context.includeExternalTypes,
		)
			? branchTypeNode
			: undefined;
	if (conditionalType.resolvedTrueType && conditionalType.resolvedFalseType) {
		return new UnionNode(undefined, [
			session.resolve(conditionalType.resolvedTrueType, preservableBranchTypeNode(trueTypeNode)),
			session.resolve(conditionalType.resolvedFalseType, preservableBranchTypeNode(falseTypeNode)),
		]);
	} else if (conditionalType.resolvedTrueType) {
		return session.resolve(
			conditionalType.resolvedTrueType,
			preservableBranchTypeNode(trueTypeNode),
		);
	} else if (conditionalType.resolvedFalseType) {
		return session.resolve(
			conditionalType.resolvedFalseType,
			preservableBranchTypeNode(falseTypeNode),
		);
	}

	return undefined;
}

function getConditionalTypeNode(
	typeNode: ts.TypeNode | undefined,
): ts.ConditionalTypeNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return ts.isConditionalTypeNode(unwrapped) ? unwrapped : undefined;
}

/**
 * Resolves index-like types without useful authored syntax by expanding their
 * base constraint. Falls back to `any` when the constraint is unavailable
 * (e.g. unresolved indexed access types) — an expected limit.
 */
export function resolveIndexLikeType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!isIndexLikeType(type)) {
		return undefined;
	}

	// Checker-internal Index and IndexedAccess shapes that reach this fallback no
	// longer have authored syntax the earlier resolvers can preserve. Expand them
	// via getBaseConstraintOfType to a representable form.
	// When the base constraint is unavailable (e.g., T[K] with unresolved type parameters),
	// fall back to 'any' silently. This is an expected limitation, not a parser bug.
	const baseConstraint = session.context.checker.getBaseConstraintOfType(type);
	if (baseConstraint) {
		return session.resolve(baseConstraint, undefined);
	}

	return new IntrinsicNode('any', typeName);
}

/**
 * Resolves a checker-internal SubstitutionType (a base type narrowed under a
 * constraint while TypeScript evaluates conditional/infer types) by probing its
 * base type and then its constraint, since the substitution has no model form.
 */
export function resolveSubstitutionFallback(
	type: ts.Type,
	session: TypeResolutionSession,
): AnyType | undefined {
	const substitutionType = type as ts.SubstitutionType;

	return (
		resolveSubstitutionCandidate(substitutionType.baseType, session) ??
		resolveSubstitutionCandidate(substitutionType.constraint, session)
	);
}

function resolveSubstitutionCandidate(
	candidateType: ts.Type,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (hasExactFlag(candidateType, ts.TypeFlags.Substitution)) {
		return undefined;
	}

	// This is a probe, not the real fallback path. If the candidate still needs
	// an unsupported-type warning, reject it and let the original substitution
	// report a single warning with the best source location.
	const warnings: unknown[] = [];
	const { context } = session;
	const onWarning = context.onWarning;
	context.onWarning = (warning) => {
		warnings.push(warning);
	};

	try {
		const resolvedCandidate = session.resolve(candidateType, undefined);
		return warnings.length === 0 && !isAnyNode(resolvedCandidate) ? resolvedCandidate : undefined;
	} finally {
		context.onWarning = onWarning;
	}
}

function isAnyNode(typeNode: AnyType): boolean {
	return typeNode instanceof IntrinsicNode && typeNode.intrinsic === 'any' && !typeNode.typeName;
}
