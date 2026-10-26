import { TypeNode } from '../node';
import { Documentation } from '../documentation';
import { TypeName } from '../typeName';

export class LiteralNode implements TypeNode {
	readonly kind = 'literal';
	public value: unknown;
	public typeName: TypeName | undefined = undefined;
	public documentation?: Documentation;

	constructor(
		value: unknown,
		typeName: TypeName | undefined = undefined,
		documentation?: Documentation,
	) {
		this.value = value;
		this.typeName = typeName?.name ? typeName : undefined;
		this.documentation = documentation;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return JSON.stringify(this.value);
	}
}
