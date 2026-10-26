import { Documentation } from '../documentation';
import { AnyType, TypeNode } from '../node';
import { TypeName } from '../typeName';
import { TypeParameterNode } from './typeParameter';

export class FunctionNode implements TypeNode {
	readonly kind = 'function';
	typeName: TypeName | undefined;
	callSignatures: CallSignature[];

	constructor(typeName: TypeName | undefined, callSignatures: CallSignature[]) {
		this.typeName =
			typeName?.name === '__function' || typeName?.name === undefined ? undefined : typeName;
		this.callSignatures = callSignatures;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return this.callSignatures.map((signature) => signature.toString()).join(' | ');
	}
}

export class CallSignature {
	constructor(
		public parameters: Parameter[],
		public returnValueType: AnyType,
		public typeParameters?: TypeParameterNode[],
	) {}

	toString(): string {
		const typeParams =
			this.typeParameters && this.typeParameters.length > 0
				? `<${this.typeParameters.map((tp) => tp.toString()).join(', ')}>`
				: '';
		return `${typeParams}(${this.parameters.map((p) => p.toString()).join(', ')}) => ${this.returnValueType.toString()}`;
	}
}

export class Parameter {
	constructor(
		public type: AnyType,
		public name: string,
		public documentation: Documentation | undefined,
		public optional: boolean,
		public defaultValue: unknown | undefined,
	) {}

	toString(): string {
		return `${this.name}: ${this.type.toString()}${this.optional ? '?' : ''}${this.defaultValue !== undefined ? ` = ${this.defaultValue}` : ''}`;
	}
}
