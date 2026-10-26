import { AnyType, TypeNode } from '../node';
import { TypeName } from '../typeName';

/** Array model that preserves element type, public alias, and readonly syntax. */
export class ArrayNode implements TypeNode {
	/** Stable model discriminator. */
	readonly kind = 'array';
	/** Optional public alias name for the complete array type. */
	public typeName: TypeName | undefined;
	/** Extracted element type. */
	public elementType: AnyType;
	/** `true` for readonly arrays; omitted for mutable arrays. */
	declare public readonly isReadonly?: true;

	/**
	 * Creates an extracted array type.
	 *
	 * @param typeName - Optional public alias name for the complete array.
	 * @param elementType - Extracted array element type.
	 * @param isReadonly - `true` when the source or semantic array is readonly.
	 */
	constructor(typeName: TypeName | undefined, elementType: AnyType, isReadonly?: true) {
		this.typeName = typeName?.name ? typeName : undefined;
		this.elementType = elementType;
		if (isReadonly) {
			this.isReadonly = true;
		}
	}

	/** @returns The public alias or rendered mutable/readonly array syntax. */
	toString(): string {
		if (this.typeName) {
			return this.typeName?.toString();
		}

		const renderedElement = this.elementType.toString();
		// TypeScript's `readonly` modifier binds to the immediately following
		// array or tuple. Parenthesize an unaliased readonly container when it is
		// itself an array element so the modifier does not move to this array.
		const isReadonlyContainer =
			(this.elementType.kind === 'array' &&
				!this.elementType.typeName &&
				this.elementType.isReadonly) ||
			(this.elementType.kind === 'tuple' &&
				!this.elementType.typeName &&
				this.elementType.isReadonly);
		const element =
			this.elementType.kind === 'typeOperator' ||
			this.elementType.kind === 'function' ||
			isReadonlyContainer
				? `(${renderedElement})`
				: renderedElement;
		return `${this.isReadonly ? 'readonly ' : ''}${element}[]`;
	}
}
