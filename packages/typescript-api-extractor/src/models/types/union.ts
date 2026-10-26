import { type AnyType, type TypeNode } from '../node';
import { typeCanonicalizer } from '../typeCanonicalizer';
import { type TypeName } from '../typeName';

export class UnionNode implements TypeNode {
	readonly kind = 'union';
	readonly typeName: TypeName | undefined;
	readonly types: readonly AnyType[];

	constructor(typeName: TypeName | undefined, types: readonly AnyType[]) {
		this.typeName = typeName;
		// Keep the constructor API consistent with other model nodes while
		// delegating normalization policy to the canonicalizer module.
		this.types = typeCanonicalizer.canonicalizeUnionMembers(types);
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return '(' + this.types.map((type) => type.toString()).join(' | ') + ')';
	}
}
