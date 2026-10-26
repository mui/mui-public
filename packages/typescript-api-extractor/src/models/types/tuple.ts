import { AnyType, TypeNode } from '../node';
import { TypeName } from '../typeName';

/** Tuple model that preserves element types, public alias, and readonly syntax. */
export class TupleNode implements TypeNode {
	/** Stable model discriminator. */
	readonly kind = 'tuple';
	/** Optional public alias name for the complete tuple type. */
	public typeName: TypeName | undefined;
	/** Extracted tuple element types in semantic order. */
	public types: AnyType[];
	/** `true` for readonly tuples; omitted for mutable tuples. */
	declare public readonly isReadonly?: true;

	/**
	 * Creates an extracted tuple type.
	 *
	 * @param typeName - Optional public alias name for the complete tuple.
	 * @param types - Extracted tuple element types in semantic order.
	 * @param isReadonly - `true` when the source or semantic tuple is readonly.
	 */
	constructor(typeName: TypeName | undefined, types: AnyType[], isReadonly?: true) {
		this.typeName = typeName?.name ? typeName : undefined;
		this.types = types;
		if (isReadonly) {
			this.isReadonly = true;
		}
	}

	/** @returns The public alias or rendered mutable/readonly tuple syntax. */
	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return `${this.isReadonly ? 'readonly ' : ''}[${this.types
			.map((type) => type.toString())
			.join(', ')}]`;
	}
}
