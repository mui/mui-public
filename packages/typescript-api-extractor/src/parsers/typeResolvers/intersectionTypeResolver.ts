import ts from 'typescript';
import { IntersectionNode, ObjectNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { areSemanticTypesEquivalent } from '../typeResolutionUtils';
import { resolveCallableType } from './functionTypeResolver';
import { resolveObjectLikeType } from './objectTypeResolver';
import { substituteTypeParameter } from './mappedTypeSubstitutions';
import {
	flattenIntersectionTypeNodes,
	getPreservableKeyofTypeNode,
	getKeyofTypeOperatorNode,
} from './typeOperatorTypeNodes';
import { getKeyofResultTypeFromSyntax } from './typeOperatorTypeResolver';

/**
 * Resolves intersections while matching checker members back to authored member syntax.
 *
 * TypeScript can reorder or merge intersection members. The resolver first
 * matches semantically equivalent syntax nodes, then preserves callable or
 * object properties that TypeScript exposes only on the merged type.
 *
 * @param request - Semantic intersection candidate and optional authored syntax.
 * @param session - Active resolution session used for members and merged shapes.
 * @returns An intersection or merged callable model, otherwise `undefined` for non-intersections.
 */
export function resolveIntersectionType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	if (!type.isIntersection()) {
		return undefined;
	}

	const memberTypeNodes = getIntersectionMemberTypeNodes(typeNode);
	const matchedMemberTypeNodes = matchIntersectionMemberTypeNodes(
		type.types,
		memberTypeNodes,
		session,
	);
	const memberTypes = type.types.map((memberType, index) => {
		const memberTypeNode = matchedMemberTypeNodes?.[index];
		return session.resolve(
			memberType,
			getPreservableKeyofTypeNode(
				memberTypeNode,
				session.context.checker,
				session.context.typeParameterTypeNodeSubstitutions,
				session.context.includeExternalTypes,
			)
				? memberTypeNode
				: undefined,
		);
	});

	if (memberTypes.length === 0) {
		throw new Error('Encountered an intersection type with no members');
	}

	if (memberTypes.length === 1) {
		return memberTypes[0];
	}

	const callSignatures = type.getCallSignatures();
	if (callSignatures.length >= 1) {
		return resolveCallableType({ type, typeName, typeNode: undefined }, session)!;
	}

	const objectType = resolveObjectLikeType({ type, typeName, typeNode: undefined }, session);
	if (objectType instanceof ObjectNode) {
		return new IntersectionNode(typeName, memberTypes, objectType.properties);
	}

	return new IntersectionNode(typeName, memberTypes, []);
}

function getIntersectionMemberTypeNodes(
	typeNode: ts.TypeNode | undefined,
): readonly ts.TypeNode[] | undefined {
	return typeNode ? flattenIntersectionTypeNodes(typeNode) : undefined;
}

function matchIntersectionMemberTypeNodes(
	memberTypes: readonly ts.Type[],
	memberTypeNodes: readonly ts.TypeNode[] | undefined,
	session: TypeResolutionSession,
): readonly (ts.TypeNode | undefined)[] | undefined {
	if (!memberTypeNodes) {
		return undefined;
	}

	const usedNodeIndexes = new Set<number>();
	return memberTypes.map((memberType) => {
		let nodeIndex = memberTypeNodes.findIndex(
			(node, index) =>
				!usedNodeIndexes.has(index) &&
				areSemanticTypesEquivalent(
					memberType,
					getTypeForIntersectionMemberNode(node, session),
					session.context.checker,
				),
		);
		if (nodeIndex === -1) {
			nodeIndex = memberTypeNodes.findIndex((_, index) => !usedNodeIndexes.has(index));
		}
		if (nodeIndex === -1) {
			return undefined;
		}

		usedNodeIndexes.add(nodeIndex);
		return memberTypeNodes[nodeIndex];
	});
}

function getTypeForIntersectionMemberNode(
	typeNode: ts.TypeNode,
	session: TypeResolutionSession,
): ts.Type {
	const operatorNode = getKeyofTypeOperatorNode(typeNode);
	if (operatorNode) {
		return getKeyofResultTypeFromSyntax(operatorNode, session.context);
	}

	const type = session.context.checker.getTypeFromTypeNode(typeNode);
	const substitutions = session.context.typeParameterSubstitutions;
	return substitutions ? substituteTypeParameter(type, substitutions) : type;
}
