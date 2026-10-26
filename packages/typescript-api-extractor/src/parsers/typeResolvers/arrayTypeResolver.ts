import ts from 'typescript';
import { ArrayNode, type AnyType } from '../../models';
import { TypeName } from '../../models/typeName';
import { getBuiltInArrayReferenceName, isSemanticallyReadonlyArray } from '../typeContainerUtils';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import {
	getPreservableKeyofTypeNode,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';

/**
 * Resolves semantic array types while preserving authored element syntax and readonly state.
 *
 * @param request - Semantic array candidate, public name, and optional authored syntax.
 * @param session - Active resolution session used for the array element.
 * @returns An array model when the checker recognizes the type as an array, otherwise `undefined`.
 */
export function resolveArrayType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	const { checker } = session.context;

	if (!checker.isArrayType(type)) {
		return undefined;
	}

	// `getElementTypeOfArrayType` is compiler-internal, but unlike reading
	// `typeArguments` directly it follows TypeScript's own array recognition and
	// works for the array shapes accepted by `checker.isArrayType` above.
	// @ts-expect-error - Private TypeChecker method intentionally isolated here.
	const arrayType: ts.Type = checker.getElementTypeOfArrayType(type);
	return new ArrayNode(
		type.aliasSymbol?.name
			? new TypeName(type.aliasSymbol?.name, typeName?.namespaces, typeName?.typeArguments)
			: undefined,
		session.resolve(
			arrayType,
			getArrayElementTypeNode(
				typeNode,
				checker,
				session.context.typeParameterTypeNodeSubstitutions,
				session.context.includeExternalTypes,
			),
		),
		isReadonlyArrayType(type, typeNode, checker) ? true : undefined,
	);
}

function isReadonlyArrayType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): boolean {
	if (isSemanticallyReadonlyArray(type)) {
		return true;
	}

	if (!typeNode) {
		return false;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (ts.isTypeOperatorNode(unwrapped) && unwrapped.operator === ts.SyntaxKind.ReadonlyKeyword) {
		return true;
	}

	return (
		ts.isTypeReferenceNode(unwrapped) &&
		getBuiltInArrayReferenceName(unwrapped, checker) === 'ReadonlyArray'
	);
}

/**
 * Recovers authored array element syntax when it can preserve a nested `keyof` expression.
 *
 * @param typeNode - Authored array, readonly-array, or parenthesized container syntax.
 * @param checker - Checker used to verify built-in `Array` and `ReadonlyArray` references.
 * @param typeParameterTypeNodeSubstitutions - Active authored generic substitutions.
 * @param includeExternalTypes - Whether syntax traversal may enter external declarations.
 * @returns The preservable element node, or `undefined` when semantic resolution is sufficient.
 */
export function getArrayElementTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
): ts.TypeNode | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(
		typeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	let elementType: ts.TypeNode | undefined;
	if (ts.isArrayTypeNode(unwrapped)) {
		elementType = unwrapped.elementType;
	}
	if (
		ts.isTypeReferenceNode(unwrapped) &&
		getBuiltInArrayReferenceName(unwrapped, checker) !== undefined
	) {
		elementType = unwrapped.typeArguments?.[0];
	}

	if (!elementType) {
		return undefined;
	}
	return getPreservableKeyofTypeNode(
		elementType,
		checker,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
	);
}
