import { AnyType, TypeNode } from '../node';
import { Documentation } from '../documentation';
import { TypeName } from '../typeName';

export interface IndexSignatureNode {
	keyName?: string;
	keyType: 'string' | 'number';
	valueType: AnyType;
}

export class ObjectNode implements TypeNode {
	readonly kind = 'object';
	public typeName: TypeName | undefined;
	public properties: PropertyNode[];
	public documentation: Documentation | undefined;
	public indexSignature: IndexSignatureNode | undefined;

	constructor(
		typeName: TypeName | undefined,
		properties: PropertyNode[],
		documentation: Documentation | undefined,
		indexSignature?: IndexSignatureNode,
	) {
		this.typeName = typeName?.name ? typeName : undefined;
		this.properties = properties;
		this.documentation = documentation;
		this.indexSignature = indexSignature;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		const parts: string[] = [];
		if (this.indexSignature) {
			const keyName = this.indexSignature.keyName ?? 'key';
			parts.push(
				`[${keyName}: ${this.indexSignature.keyType}]: ${this.indexSignature.valueType.toString()}`,
			);
		}
		parts.push(...this.properties.map((p) => p.toString()));
		return `{ ${parts.join(', ')} }`;
	}
}

export class PropertyNode {
	constructor(
		public name: string,
		public type: AnyType,
		public documentation: Documentation | undefined,
		public optional: boolean,
	) {}

	toString(): string {
		return `${this.name}${this.optional ? '?:' : ':'} ${this.type.toString()}`;
	}
}
