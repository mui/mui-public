import ts from 'typescript';
import {
	ArrayNode,
	FunctionNode,
	IntrinsicNode,
	IntersectionNode,
	ObjectNode,
	TupleNode,
	UnionNode,
	type AnyType,
} from '../models';
import { TypeName } from '../models/typeName';
import { isSemanticallyReadonlyArray, isSemanticallyReadonlyTuple } from './typeContainerUtils';

/**
 * Returns true only when every bit of `flag` is set on the type. Use for flags
 * that must match exactly, as opposed to `includesCompositeFlag`.
 *
 * @param type - Checker type whose flags should be tested.
 * @param flag - Single or composite flag mask that must be fully present.
 * @returns Whether every requested bit is present.
 */
export function hasExactFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) === flag;
}

/**
 * Returns true when the type has any bit of `flag` set. Use for composite flag
 * groups such as `Literal` or `EnumLike`, where matching any member is enough.
 *
 * @param type - Checker type whose flags should be tested.
 * @param flag - Flag group for which any matching bit is sufficient.
 * @returns Whether at least one requested bit is present.
 */
export function includesCompositeFlag(type: ts.Type, flag: number) {
	return (type.flags & flag) !== 0;
}

/**
 * Compares checker types by mutual assignability. Most resolution matching can
 * use TypeScript's normal assignability semantics, while collapsed conditional
 * branches need `any` to match only another `any`.
 *
 * @param type1 - First semantic type to compare.
 * @param type2 - Second semantic type to compare.
 * @param checker - Checker used for mutual assignability tests.
 * @param anyPolicy - Whether unaliased `any` follows assignability or exact matching.
 * @returns Whether the two types are equivalent under the selected policy.
 */
export function areSemanticTypesEquivalent(
	type1: ts.Type,
	type2: ts.Type,
	checker: ts.TypeChecker,
	anyPolicy: 'assignable' | 'exact' = 'assignable',
): boolean {
	if (anyPolicy === 'exact' && (type1.flags & ts.TypeFlags.Any || type2.flags & ts.TypeFlags.Any)) {
		return Boolean(type1.flags & ts.TypeFlags.Any) && Boolean(type2.flags & ts.TypeFlags.Any);
	}

	return checker.isTypeAssignableTo(type1, type2) && checker.isTypeAssignableTo(type2, type1);
}

/**
 * Reads TypeScript's stable per-program identity for a checker type.
 *
 * The field is private compiler API. Cache keys and recursion detection require
 * an identity that survives wrapper objects, so the unsafe access is isolated
 * here and callers must handle `undefined` for types without an assigned ID.
 *
 * @param type - Checker type whose internal identity should be read.
 * @returns The internal numeric ID when TypeScript assigned one.
 */
export function getTypeId(type: ts.Type): number | undefined {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (type as any).id;
}

/**
 * Returns the checker result of applying `keyof` to an operand. TypeScript uses
 * this method internally but does not expose it in the public TypeChecker type.
 *
 * @param checker - Checker that owns the operand type.
 * @param operandType - Semantic operand to which `keyof` should be applied.
 * @returns The semantic key type, or `undefined` when the internal API is unavailable.
 */
export function getKeyofTypeForOperand(
	checker: ts.TypeChecker,
	operandType: ts.Type,
): ts.Type | undefined {
	const checkerWithIndexType = checker as ts.TypeChecker & {
		getIndexType?: (type: ts.Type) => ts.Type;
	};
	return checkerWithIndexType.getIndexType?.(operandType);
}

/**
 * Creates a shallow type node for cycle detection. The result keeps the outer
 * type identity but does not resolve nested members, preventing recursive
 * object/array/function types from expanding forever.
 *
 * @param type - Recursive semantic type whose outer shape should be preserved.
 * @param typeName - Public name already derived for the type.
 * @param checker - Checker used to distinguish array and tuple shapes.
 * @returns A model node with the same outer kind and no recursively resolved members.
 */
export function createShallowType(
	type: ts.Type,
	typeName: TypeName | undefined,
	checker: ts.TypeChecker,
): AnyType {
	if (type.isUnion()) {
		return new UnionNode(typeName, []);
	}

	if (type.isIntersection()) {
		return new IntersectionNode(typeName, [], []);
	}

	if (checker.isArrayType(type)) {
		return new ArrayNode(
			type.aliasSymbol?.name
				? new TypeName(type.aliasSymbol.name, typeName?.namespaces, typeName?.typeArguments)
				: undefined,
			new IntrinsicNode('any'),
			isSemanticallyReadonlyArray(type) ? true : undefined,
		);
	}

	if (checker.isTupleType(type)) {
		return new TupleNode(typeName, [], isSemanticallyReadonlyTuple(type) ? true : undefined);
	}

	if (type.getCallSignatures().length >= 1) {
		return new FunctionNode(typeName, []);
	}

	return new ObjectNode(typeName, [], undefined);
}

// Internal TypeScript API used when enum literal types point at a member symbol
// and the parser needs to recover the parent enum symbol.
declare module 'typescript' {
	interface Symbol {
		parent?: ts.Symbol;
	}
}
