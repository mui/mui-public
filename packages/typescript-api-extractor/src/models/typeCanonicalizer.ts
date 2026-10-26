import { type AnyType } from './node';
import { typeEquivalenceChecker } from './typeEquivalence';
import { FunctionNode } from './types/function';
import { IntrinsicNode } from './types/intrinsic';
import { LiteralNode } from './types/literal';
import { ExternalTypeNode } from './types/external';
import { TypeOperatorNode } from './types/typeOperator';
import { TypeParameterNode } from './types/typeParameter';

// UnionNode and IntersectionNode are matched by `kind` rather than imported and
// checked with `instanceof`: those DTOs canonicalize themselves through this
// module, so importing them here would form a module-initialization cycle
// (types/union.ts -> typeCanonicalizer.ts -> types/union.ts).

/**
 * Normalizes compound type members before they are placed in a model DTO.
 * Handles examples like `(A | B) | undefined`, `true | false`, and duplicate
 * overload signatures that differ only by `any` fallback members.
 */
class TypeCanonicalizer {
	/**
	 * Canonicalizes members before constructing a union model.
	 *
	 * @param types - Union members in authored or checker-provided order.
	 * @returns Flattened, simplified, stably ordered, and deduplicated members.
	 */
	canonicalizeUnionMembers(types: readonly AnyType[]): AnyType[] {
		const flatTypes = this.flattenTypes(types, 'union');
		this.sanitizeBooleanLiterals(flatTypes);
		this.sanitizeNeverMembers(flatTypes);
		this.sortMemberTypes(flatTypes);
		return this.deduplicateMemberTypes(flatTypes);
	}

	/**
	 * Canonicalizes members before constructing an intersection model.
	 *
	 * @param types - Intersection members in authored or checker-provided order.
	 * @returns Flattened, stably ordered, and deduplicated members.
	 */
	canonicalizeIntersectionMembers(types: readonly AnyType[]): AnyType[] {
		const flatTypes = this.flattenTypes(types, 'intersection');
		this.sortMemberTypes(flatTypes);
		return this.deduplicateMemberTypes(flatTypes);
	}

	/**
	 * Flattens nested, unaliased compound nodes. Aliased compounds are preserved
	 * because their TypeName is part of the public API identity.
	 *
	 * @param nodes - Compound members that may themselves contain the same compound kind.
	 * @param kind - Compound kind whose unaliased nested members should be flattened.
	 * @returns A new flat member array in source order.
	 */
	flattenTypes(nodes: readonly AnyType[], kind: 'union' | 'intersection'): AnyType[] {
		let flatTypes: AnyType[] = [];
		nodes.forEach((node) => {
			if (node.kind === kind && !node.typeName) {
				flatTypes = flatTypes.concat(this.flattenTypes(node.types, kind));
			} else {
				flatTypes.push(node);
			}
		});

		return flatTypes;
	}

	/**
	 * Removes structurally duplicate members while preserving original order.
	 * Function and type-operator members use the equivalence checker; concrete
	 * overload signatures win over otherwise identical signatures containing
	 * `any` fallbacks.
	 *
	 * The three indexes deliberately share the `deduplicated` array. A function
	 * wildcard can therefore be replaced in place without moving surrounding
	 * members, while scalar model nodes use cheap stable keys and complex model
	 * nodes retain identity-based deduplication.
	 *
	 * @param types - Members after flattening and kind-specific simplification.
	 * @returns Members with redundant equivalents removed.
	 */
	deduplicateMemberTypes(types: readonly AnyType[]): AnyType[] {
		const deduplicated: AnyType[] = [];
		const functionIndexes: number[] = [];
		const typeOperatorIndexes: number[] = [];
		const seenNonFunctionKeys = new Set<unknown>();

		for (const type of types) {
			if (type instanceof FunctionNode) {
				const existingIndex = functionIndexes.find((index) =>
					typeEquivalenceChecker.areFunctionsEquivalentIgnoringAny(
						deduplicated[index] as FunctionNode,
						type,
					),
				);
				if (existingIndex === undefined) {
					functionIndexes.push(deduplicated.length);
					deduplicated.push(type);
				} else if (
					typeEquivalenceChecker.containsAny(deduplicated[existingIndex]) &&
					!typeEquivalenceChecker.containsAny(type)
				) {
					deduplicated[existingIndex] = type;
				}
				continue;
			}

			if (type instanceof TypeOperatorNode) {
				const alreadyIncluded = typeOperatorIndexes.some((index) =>
					typeEquivalenceChecker.areEquivalentStrictly(
						deduplicated[index] as TypeOperatorNode,
						type,
					),
				);
				if (!alreadyIncluded) {
					typeOperatorIndexes.push(deduplicated.length);
					deduplicated.push(type);
				}
				continue;
			}

			const uniqueKey = this.getNonFunctionMemberKey(type);
			if (!seenNonFunctionKeys.has(uniqueKey)) {
				seenNonFunctionKeys.add(uniqueKey);
				deduplicated.push(type);
			}
		}

		return deduplicated;
	}

	/**
	 * Keeps `null` and `undefined` at the end of compound member lists for stable
	 * rendering while leaving authored order of the remaining members intact.
	 *
	 * @param members - Mutable member list to reorder in place.
	 */
	sortMemberTypes(members: AnyType[]): void {
		const nullIndex = members.findIndex(
			(member) => member instanceof IntrinsicNode && member.intrinsic === 'null',
		);
		if (nullIndex !== -1) {
			members.push(members.splice(nullIndex, 1)[0]);
		}

		const undefinedIndex = members.findIndex(
			(member) => member instanceof IntrinsicNode && member.intrinsic === 'undefined',
		);
		if (undefinedIndex !== -1) {
			members.push(members.splice(undefinedIndex, 1)[0]);
		}
	}

	private sanitizeBooleanLiterals(members: AnyType[]): void {
		const trueLiteralIndex = members.findIndex(
			(member) => member instanceof LiteralNode && member.value === 'true',
		);
		const falseLiteralIndex = members.findIndex(
			(member) => member instanceof LiteralNode && member.value === 'false',
		);

		if (trueLiteralIndex !== -1 && falseLiteralIndex !== -1) {
			const booleanNode = new IntrinsicNode('boolean');
			if (trueLiteralIndex > falseLiteralIndex) {
				members.splice(trueLiteralIndex, 1);
				members.splice(falseLiteralIndex, 1, booleanNode);
			} else {
				members.splice(falseLiteralIndex, 1);
				members.splice(trueLiteralIndex, 1, booleanNode);
			}
		}
	}

	private sanitizeNeverMembers(members: AnyType[]): void {
		if (members.length <= 1) {
			return;
		}

		const hasNonRedundantMember = members.some(
			(member) =>
				!(member instanceof IntrinsicNode && member.intrinsic === 'never' && !member.typeName),
		);

		if (!hasNonRedundantMember) {
			return;
		}

		for (let i = members.length - 1; i >= 0; i--) {
			const member = members[i];
			if (member instanceof IntrinsicNode && member.intrinsic === 'never' && !member.typeName) {
				members.splice(i, 1);
			}
		}
	}

	private getNonFunctionMemberKey(type: AnyType): unknown {
		if (type instanceof LiteralNode) {
			return `literal:${type.value}`;
		}
		if (type instanceof ExternalTypeNode) {
			return `external:${typeEquivalenceChecker.getExternalSourceKey(type)}:${type.typeName.toString()}`;
		}
		if (type instanceof TypeParameterNode) {
			return `typeparam:${type.name}`;
		}
		if (type instanceof IntrinsicNode) {
			return `intrinsic:${type.typeName?.toString() ?? type.intrinsic}`;
		}

		// Everything else dedups by identity.
		return type;
	}
}

/** Shared compound-type normalization policy used by union and intersection DTOs. */
export const typeCanonicalizer = new TypeCanonicalizer();
