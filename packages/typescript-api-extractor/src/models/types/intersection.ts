import { type AnyType, type TypeNode } from '../node';
import { typeCanonicalizer } from '../typeCanonicalizer';
import { type PropertyNode } from './object';
import { type TypeName } from '../typeName';

export class IntersectionNode implements TypeNode {
	readonly kind = 'intersection';
	readonly typeName: TypeName | undefined;
	readonly types: readonly AnyType[];
	readonly properties: readonly PropertyNode[] = [];

	constructor(
		typeName: TypeName | undefined,
		types: readonly AnyType[],
		properties: readonly PropertyNode[],
	) {
		this.typeName = typeName?.name ? typeName : undefined;
		// Keep the constructor API consistent with other model nodes while
		// delegating normalization policy to the canonicalizer module.
		this.types = typeCanonicalizer.canonicalizeIntersectionMembers(types);
		this.properties = [...properties];
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return '(' + this.types.map((type) => type.toString()).join(' & ') + ')';
	}
}
