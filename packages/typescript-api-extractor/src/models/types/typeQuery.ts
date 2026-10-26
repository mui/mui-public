import { type TypeNode } from '../node';
import { type TypeName } from '../typeName';

/** Authored `typeof` type query retained without expanding the queried value. */
export class TypeQueryNode implements TypeNode {
	/** Stable model discriminator. */
	readonly kind = 'typeQuery';
	/** Type queries currently retain syntax rather than a separate public alias. */
	readonly typeName: TypeName | undefined = undefined;
	/** Authored value or import expression following `typeof`. */
	readonly expressionName: string;

	/**
	 * Creates a preserved type query.
	 *
	 * @param expressionName - Authored value or import expression following `typeof`.
	 */
	constructor(expressionName: string) {
		this.expressionName = expressionName;
	}

	/** @returns The authored `typeof` expression. */
	toString(): string {
		return `typeof ${this.expressionName}`;
	}
}
