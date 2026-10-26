import ts from 'typescript';
import { IntrinsicNode, UnionNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { hasExactFlag } from '../typeResolutionUtils';

// Intrinsic handling covers TypeScript flags that map directly to
// IntrinsicNode values. Keeping them in one resolver avoids artificial splits
// like "boolean-or-void" versus "scalar" while the registry still controls
// where all intrinsic flags sit in resolver precedence.

export function resolveIntrinsicType(
	{ type, typeName, typeNode }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { checker } = session.context;

	if (hasExactFlag(type, ts.TypeFlags.Boolean)) {
		return new IntrinsicNode('boolean');
	}

	if (hasExactFlag(type, ts.TypeFlags.Void)) {
		return new IntrinsicNode('void');
	}

	if (hasExactFlag(type, ts.TypeFlags.String)) {
		return new IntrinsicNode('string');
	}

	if (hasExactFlag(type, ts.TypeFlags.Number)) {
		return new IntrinsicNode('number');
	}

	if (hasExactFlag(type, ts.TypeFlags.BigInt)) {
		return new IntrinsicNode('bigint');
	}

	if (
		hasExactFlag(type, ts.TypeFlags.ESSymbol) ||
		hasExactFlag(type, ts.TypeFlags.UniqueESSymbol)
	) {
		return new IntrinsicNode('symbol', typeName);
	}

	if (hasExactFlag(type, ts.TypeFlags.Undefined)) {
		return new IntrinsicNode('undefined');
	}

	if (hasExactFlag(type, ts.TypeFlags.Any)) {
		// Special case: if the authored typeNode is a union (e.g., `AliasedAny | undefined`),
		// resolve it as a union to preserve alias information even though TypeScript
		// simplifies `any | T` to just `any` in the type system.
		if (typeNode && ts.isUnionTypeNode(typeNode)) {
			const unionTypes = typeNode.types.map((memberTypeNode) =>
				session.resolve(checker.getTypeFromTypeNode(memberTypeNode), memberTypeNode),
			);
			return new UnionNode(typeName, unionTypes);
		}

		return new IntrinsicNode('any', typeName);
	}

	if (hasExactFlag(type, ts.TypeFlags.Unknown)) {
		return new IntrinsicNode('unknown', typeName);
	}

	if (hasExactFlag(type, ts.TypeFlags.Null)) {
		return new IntrinsicNode('null');
	}

	if (hasExactFlag(type, ts.TypeFlags.Never)) {
		return new IntrinsicNode('never', typeName);
	}

	return undefined;
}
