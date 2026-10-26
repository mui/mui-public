import { ArrayNode } from './types/array';
import { ExternalTypeNode } from './types/external';
import { FunctionNode } from './types/function';
import { IntrinsicNode } from './types/intrinsic';
import { ObjectNode } from './types/object';
import { TemplateLiteralNode } from './types/templateLiteral';
import { TupleNode } from './types/tuple';
import { TypeOperatorNode } from './types/typeOperator';
import { TypeParameterNode } from './types/typeParameter';
import { type AnyType } from './node';

// UnionNode and IntersectionNode are matched by `kind` rather than `instanceof`:
// they construct themselves through typeCanonicalizer, which imports this module,
// so importing them here would form a module-initialization cycle.

type TypeParameterRenameMap = ReadonlyMap<string, string>;
type EquivalentTypeName = {
	name: string;
	namespaces?: readonly string[];
	typeArguments?: readonly { type: AnyType }[];
};

/**
 * Compares model types structurally for canonicalization. The visitor treats
 * unaliased `any` as a wildcard, which lets generated overload unions prefer a
 * concrete signature over a duplicate fallback signature containing `any`.
 */
class TypeEquivalence {
	/**
	 * Compares model types while treating an unaliased `any` as a wildcard.
	 *
	 * @param type1 - First model type to compare.
	 * @param type2 - Second model type to compare.
	 * @param typeParamRenames - Optional right-to-left generic parameter renames.
	 * @returns Whether the types are equivalent under wildcard-`any` semantics.
	 */
	areEquivalentIgnoringAny(
		type1: AnyType,
		type2: AnyType,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		return this.areEquivalent(type1, type2, true, typeParamRenames);
	}

	/**
	 * Compares model types without wildcard matching.
	 *
	 * @param type1 - First model type to compare.
	 * @param type2 - Second model type to compare.
	 * @param typeParamRenames - Optional right-to-left generic parameter renames.
	 * @returns Whether the types are structurally equivalent.
	 */
	areEquivalentStrictly(
		type1: AnyType,
		type2: AnyType,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		return this.areEquivalent(type1, type2, false, typeParamRenames);
	}

	private areEquivalent(
		type1: AnyType,
		type2: AnyType,
		anyIsWildcard: boolean,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		// If either side is an unaliased `any` (no typeName), it matches any type.
		const type1IsAny = type1 instanceof IntrinsicNode && type1.intrinsic === 'any';
		const type2IsAny = type2 instanceof IntrinsicNode && type2.intrinsic === 'any';
		const type1IsUnaliasedAny = type1IsAny && !type1.typeName;
		const type2IsUnaliasedAny = type2IsAny && !type2.typeName;
		if (anyIsWildcard && (type1IsUnaliasedAny || type2IsUnaliasedAny)) {
			return true;
		}

		// Type parameters compare by identity, with scoped alpha-renames applied
		// for equivalent function signatures such as `<T>(value: T)` and
		// `<U>(value: U)`.
		if (type1 instanceof TypeParameterNode && type2 instanceof TypeParameterNode) {
			const name2Renamed = typeParamRenames?.get(type2.name) ?? type2.name;
			return type1.name === name2Renamed;
		}

		// A type parameter named "string" must not match the intrinsic `string`.
		if (type1 instanceof TypeParameterNode || type2 instanceof TypeParameterNode) {
			return false;
		}

		// Equally named external types can come from unrelated declarations, such
		// as the DOM `Range` and a package's own `Range`.
		if (
			type1 instanceof ExternalTypeNode &&
			type2 instanceof ExternalTypeNode &&
			this.getExternalSourceKey(type1) !== this.getExternalSourceKey(type2)
		) {
			return false;
		}

		// Alias identity wins over shape. Two aliases with equal names and type
		// arguments match; aliased and inline forms intentionally do not.
		const tn1 = 'typeName' in type1 ? type1.typeName : undefined;
		const tn2 = 'typeName' in type2 ? type2.typeName : undefined;
		if (tn1 || tn2) {
			if (tn1 && tn2) {
				return this.typeNamesAreEquivalent(tn1, tn2, anyIsWildcard, typeParamRenames);
			}
			return false;
		}

		if (type1 instanceof FunctionNode && type2 instanceof FunctionNode) {
			return this.areFunctionsEquivalent(type1, type2, anyIsWildcard, typeParamRenames);
		}

		if (type1.kind === 'union' && type2.kind === 'union') {
			return this.membersAreEquivalentUnordered(
				type1.types,
				type2.types,
				anyIsWildcard,
				typeParamRenames,
			);
		}

		if (type1.kind === 'intersection' && type2.kind === 'intersection') {
			return this.membersAreEquivalentUnordered(
				type1.types,
				type2.types,
				anyIsWildcard,
				typeParamRenames,
			);
		}

		if (type1 instanceof ArrayNode && type2 instanceof ArrayNode) {
			return (
				this.areEquivalent(type1.elementType, type2.elementType, anyIsWildcard, typeParamRenames) &&
				type1.isReadonly === type2.isReadonly
			);
		}

		if (type1 instanceof TupleNode && type2 instanceof TupleNode) {
			if (type1.types.length !== type2.types.length || type1.isReadonly !== type2.isReadonly) {
				return false;
			}
			return type1.types.every((t1, index) =>
				this.areEquivalent(t1, type2.types[index], anyIsWildcard, typeParamRenames),
			);
		}

		if (type1 instanceof TemplateLiteralNode && type2 instanceof TemplateLiteralNode) {
			// Equal text lists also mean equal placeholder counts.
			if (
				type1.texts.length !== type2.texts.length ||
				type1.texts.some((text, index) => text !== type2.texts[index])
			) {
				return false;
			}
			return type1.types.every((t1, index) =>
				this.areEquivalent(t1, type2.types[index], anyIsWildcard, typeParamRenames),
			);
		}

		if (type1 instanceof TypeOperatorNode && type2 instanceof TypeOperatorNode) {
			// Resolved operator payloads can contain hundreds of keys and this comparison
			// runs pairwise during union canonicalization. Reject different authored
			// operators and operands before traversing that potentially large result.
			if (
				type1.operator !== type2.operator ||
				type1.resolutionKind !== type2.resolutionKind ||
				// `any` inside authored operator syntax is semantic (`keyof any`), not
				// a generated fallback that may wildcard-match another operand.
				!this.areEquivalent(type1.type, type2.type, false, typeParamRenames)
			) {
				return false;
			}

			const resolvedTypesAreEquivalent =
				type1.resolvedType && type2.resolvedType
					? this.areEquivalent(type1.resolvedType, type2.resolvedType, false, typeParamRenames)
					: type1.resolvedType === type2.resolvedType;
			return resolvedTypesAreEquivalent;
		}

		if (type1 instanceof ExternalTypeNode && type2 instanceof ExternalTypeNode) {
			return this.typeNamesAreEquivalent(
				type1.typeName,
				type2.typeName,
				anyIsWildcard,
				typeParamRenames,
			);
		}

		if (type1 instanceof ObjectNode && type2 instanceof ObjectNode) {
			return this.objectTypesAreEquivalent(type1, type2, anyIsWildcard, typeParamRenames);
		}

		// Leaf model nodes that do not contain nested type parameters can safely
		// fall back to their rendering identity.
		return type1.toString() === type2.toString();
	}

	/**
	 * Compares function signatures, including generic constraints/defaults.
	 * Handles examples like `<T>(value: T) => T` and `<U>(value: U) => U` as
	 * equivalent while rejecting different aliases or parameter optionality.
	 *
	 * @param func1 - First function model to compare.
	 * @param func2 - Second function model to compare.
	 * @param outerTypeParamRenames - Generic parameter renames inherited from an outer scope.
	 * @returns Whether the signatures are equivalent under wildcard-`any` semantics.
	 */
	areFunctionsEquivalentIgnoringAny(
		func1: FunctionNode,
		func2: FunctionNode,
		outerTypeParamRenames?: TypeParameterRenameMap,
	): boolean {
		return this.areFunctionsEquivalent(func1, func2, true, outerTypeParamRenames);
	}

	/**
	 * Compares type parameter lists by position, without wildcard matching. Names
	 * are not compared, so `<T extends string>` and `<U extends string>` match.
	 *
	 * @param typeParameters1 - First type parameter list to compare.
	 * @param typeParameters2 - Second type parameter list to compare.
	 * @returns Whether both lists have equivalent constraints and defaults.
	 */
	areTypeParameterListsEquivalentStrictly(
		typeParameters1: TypeParameterNode[],
		typeParameters2: TypeParameterNode[],
	): boolean {
		return this.areTypeParameterListsEquivalent(typeParameters1, typeParameters2, false);
	}

	private areTypeParameterListsEquivalent(
		typeParameters1: TypeParameterNode[],
		typeParameters2: TypeParameterNode[],
		anyIsWildcard: boolean,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		return (
			typeParameters1.length === typeParameters2.length &&
			typeParameters1.every((typeParameter1, index) => {
				const typeParameter2 = typeParameters2[index];
				return (
					this.areOptionalTypesEquivalent(
						typeParameter1.constraint,
						typeParameter2.constraint,
						anyIsWildcard,
						typeParamRenames,
					) &&
					this.areOptionalTypesEquivalent(
						typeParameter1.defaultValue,
						typeParameter2.defaultValue,
						anyIsWildcard,
						typeParamRenames,
					)
				);
			})
		);
	}

	private areOptionalTypesEquivalent(
		type1: AnyType | undefined,
		type2: AnyType | undefined,
		anyIsWildcard: boolean,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		if (!type1 || !type2) {
			return type1 === type2;
		}

		return this.areEquivalent(type1, type2, anyIsWildcard, typeParamRenames);
	}

	private areFunctionsEquivalent(
		func1: FunctionNode,
		func2: FunctionNode,
		anyIsWildcard: boolean,
		outerTypeParamRenames?: TypeParameterRenameMap,
	): boolean {
		const typeName1 = func1.typeName;
		const typeName2 = func2.typeName;
		if (Boolean(typeName1) !== Boolean(typeName2)) {
			return false;
		}
		if (
			typeName1 &&
			typeName2 &&
			!this.typeNamesAreEquivalent(typeName1, typeName2, anyIsWildcard, outerTypeParamRenames)
		) {
			return false;
		}

		if (func1.callSignatures.length !== func2.callSignatures.length) {
			return false;
		}

		for (let i = 0; i < func1.callSignatures.length; i++) {
			const sig1 = func1.callSignatures[i];
			const sig2 = func2.callSignatures[i];

			const typeParamRenames = this.buildSignatureTypeParameterRenames(
				sig1.typeParameters ?? [],
				sig2.typeParameters ?? [],
				outerTypeParamRenames,
			);
			if (!typeParamRenames) {
				return false;
			}

			if (
				!this.areTypeParameterListsEquivalent(
					sig1.typeParameters ?? [],
					sig2.typeParameters ?? [],
					anyIsWildcard,
					typeParamRenames,
				)
			) {
				return false;
			}

			if (sig1.parameters.length !== sig2.parameters.length) {
				return false;
			}

			if (
				!this.areEquivalent(
					sig1.returnValueType,
					sig2.returnValueType,
					anyIsWildcard,
					typeParamRenames,
				)
			) {
				return false;
			}

			for (let j = 0; j < sig1.parameters.length; j++) {
				const param1 = sig1.parameters[j];
				const param2 = sig2.parameters[j];

				if (param1.name !== param2.name || param1.optional !== param2.optional) {
					return false;
				}

				if (!this.areEquivalent(param1.type, param2.type, anyIsWildcard, typeParamRenames)) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * Identifies where an external type is declared, for telling equally named
	 * external types apart. Default library types share one key because the
	 * library merges every declaration of a global name into the same type.
	 *
	 * @param type - External type whose source should be keyed.
	 * @returns A key that is equal for external types from the same source.
	 */
	getExternalSourceKey(type: ExternalTypeNode): string {
		if (!type.source) {
			return '';
		}

		return type.source.kind === 'lib' ? 'lib' : `package:${type.source.name}`;
	}

	/**
	 * Detects whether a type contains `any` directly or in nested signatures,
	 * members, properties, constraints, or default type parameters.
	 *
	 * @param type - Model type to inspect recursively.
	 * @returns Whether an intrinsic `any` occurs in the model.
	 */
	containsAny(type: AnyType): boolean {
		if (type instanceof IntrinsicNode && type.intrinsic === 'any') {
			return true;
		}

		if (type instanceof FunctionNode) {
			return type.callSignatures.some(
				(signature) =>
					signature.parameters.some((parameter) => this.containsAny(parameter.type)) ||
					this.containsAny(signature.returnValueType) ||
					(signature.typeParameters ?? []).some(
						(typeParameter) =>
							(typeParameter.constraint != null && this.containsAny(typeParameter.constraint)) ||
							(typeParameter.defaultValue != null && this.containsAny(typeParameter.defaultValue)),
					),
			);
		}

		if (type.kind === 'union' || type.kind === 'intersection') {
			return type.types.some((member) => this.containsAny(member));
		}

		if (type instanceof ArrayNode) {
			return this.containsAny(type.elementType);
		}

		if (type instanceof TupleNode || type instanceof TemplateLiteralNode) {
			return type.types.some((member) => this.containsAny(member));
		}

		if (type instanceof TypeOperatorNode) {
			return (
				this.containsAny(type.type) ||
				(type.resolvedType !== undefined && this.containsAny(type.resolvedType))
			);
		}

		if (type instanceof ObjectNode) {
			return (
				type.properties.some((property) => this.containsAny(property.type)) ||
				(type.indexSignature?.valueType != null && this.containsAny(type.indexSignature.valueType))
			);
		}

		if (type instanceof ExternalTypeNode) {
			const args = type.typeName.typeArguments;
			return args != null && args.some((arg) => this.containsAny(arg.type));
		}

		return false;
	}

	private typeNamesAreEquivalent(
		typeName1: EquivalentTypeName,
		typeName2: EquivalentTypeName,
		anyIsWildcard: boolean,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		if (typeName1.name !== typeName2.name) {
			return false;
		}

		const namespaces1 = typeName1.namespaces ?? [];
		const namespaces2 = typeName2.namespaces ?? [];
		if (
			namespaces1.length !== namespaces2.length ||
			namespaces1.some((namespace, index) => namespace !== namespaces2[index])
		) {
			return false;
		}

		const args1 = typeName1.typeArguments ?? [];
		const args2 = typeName2.typeArguments ?? [];
		if (args1.length !== args2.length) {
			return false;
		}

		return args1.every((arg, index) =>
			this.areEquivalent(arg.type, args2[index].type, anyIsWildcard, typeParamRenames),
		);
	}

	private membersAreEquivalentUnordered(
		types1: readonly AnyType[],
		types2: readonly AnyType[],
		anyIsWildcard: boolean,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		const n = types1.length;
		if (n !== types2.length) {
			return false;
		}
		if (n === 0) {
			return true;
		}

		// Canonicalized unions and intersections normally retain the same stable
		// member order on both sides. Prove that common case in O(n) before
		// constructing the bipartite graph needed for genuinely reordered or
		// wildcard-compatible members.
		let matchesInOrder = true;
		for (let index = 0; index < n; index += 1) {
			if (!this.areEquivalent(types1[index], types2[index], anyIsWildcard, typeParamRenames)) {
				matchesInOrder = false;
				break;
			}
		}
		if (matchesInOrder) {
			return true;
		}

		// Use a cheap key multiset pre-check before the O(n^3) bipartite match,
		// but skip it when wildcard `any` or rename maps would make keys unsafe.
		const hasAnyWildcard =
			anyIsWildcard &&
			[...types1, ...types2].some(
				(type) => type instanceof IntrinsicNode && type.intrinsic === 'any' && !type.typeName,
			);
		const hasTypeParamRenames = typeParamRenames != null && typeParamRenames.size > 0;
		if (!hasAnyWildcard && !hasTypeParamRenames) {
			if (!this.structuralKeyMultisetsMatch(types1, types2)) {
				return false;
			}
		}

		const adjacency: number[][] = [];
		for (let j = 0; j < n; j++) {
			adjacency[j] = [];
			for (let i = 0; i < n; i++) {
				if (this.areEquivalent(types1[j], types2[i], anyIsWildcard, typeParamRenames)) {
					adjacency[j].push(i);
				}
			}
		}

		const match2 = new Array<number>(n).fill(-1);
		const tryAugment = (j: number, visited: boolean[]): boolean => {
			for (const i of adjacency[j]) {
				if (visited[i]) {
					continue;
				}
				visited[i] = true;
				if (match2[i] === -1 || tryAugment(match2[i], visited)) {
					match2[i] = j;
					return true;
				}
			}
			return false;
		};

		for (let j = 0; j < n; j++) {
			if (!tryAugment(j, new Array<boolean>(n).fill(false))) {
				return false;
			}
		}

		return true;
	}

	private objectTypesAreEquivalent(
		type1: ObjectNode,
		type2: ObjectNode,
		anyIsWildcard: boolean,
		typeParamRenames?: TypeParameterRenameMap,
	): boolean {
		if (type1.properties.length !== type2.properties.length) {
			return false;
		}

		const index1 = type1.indexSignature;
		const index2 = type2.indexSignature;
		if (index1 && index2) {
			if (
				index1.keyType !== index2.keyType ||
				!this.areEquivalent(index1.valueType, index2.valueType, anyIsWildcard, typeParamRenames)
			) {
				return false;
			}
		} else if (index1 || index2) {
			return false;
		}

		const propMap = new Map<string, (typeof type2.properties)[number]>();
		for (const property of type2.properties) {
			propMap.set(`${property.name}:${property.optional}`, property);
		}

		return type1.properties.every((property1) => {
			const property2 = propMap.get(`${property1.name}:${property1.optional}`);
			return (
				property2 != null &&
				this.areEquivalent(property1.type, property2.type, anyIsWildcard, typeParamRenames)
			);
		});
	}

	private buildSignatureTypeParameterRenames(
		typeParameters1: readonly { name: string }[],
		typeParameters2: readonly { name: string }[],
		outerTypeParamRenames?: TypeParameterRenameMap,
	): Map<string, string> | undefined {
		if (typeParameters1.length !== typeParameters2.length) {
			return undefined;
		}

		const typeParamRenames = new Map<string, string>(outerTypeParamRenames);
		for (let index = 0; index < typeParameters1.length; index++) {
			typeParamRenames.set(typeParameters2[index].name, typeParameters1[index].name);
		}

		return typeParamRenames;
	}

	private structuralKeyMultisetsMatch(
		types1: readonly AnyType[],
		types2: readonly AnyType[],
	): boolean {
		const keyCounts1 = this.countStructuralKeys(types1);
		const keyCounts2 = this.countStructuralKeys(types2);
		if (keyCounts1.size !== keyCounts2.size) {
			return false;
		}

		for (const [key, count1] of keyCounts1) {
			if (keyCounts2.get(key) !== count1) {
				return false;
			}
		}

		return true;
	}

	private countStructuralKeys(types: readonly AnyType[]): Map<string, number> {
		const keyCounts = new Map<string, number>();
		for (const type of types) {
			const key = this.memberStructuralKey(type);
			keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
		}
		return keyCounts;
	}

	private memberStructuralKey(type: AnyType): string {
		const kind = type.kind;
		const name = 'name' in type && type.name ? String(type.name) : '';
		const value = 'value' in type && type.value != null ? String(type.value) : '';

		if (type instanceof IntrinsicNode) {
			return `${kind}|${name}|${value}|${type.intrinsic}`;
		}

		return `${kind}|${name}|${value}`;
	}
}

/** Shared structural-equivalence service used by compound canonicalization. */
export const typeEquivalenceChecker = new TypeEquivalence();
