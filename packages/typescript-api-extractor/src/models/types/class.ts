import { Documentation } from '../documentation';
import { AnyType, TypeNode } from '../node';
import { TypeName } from '../typeName';
import { CallSignature, Parameter } from './function';

export class ClassNode implements TypeNode {
	readonly kind = 'class';
	typeName: TypeName | undefined;
	constructSignatures: ConstructSignature[];
	/** Instance properties of the class */
	properties: ClassProperty[];
	/** Instance methods of the class */
	methods: ClassMethod[];
	/** Type parameters (generics) of the class */
	typeParameters: TypeName[] | undefined;

	constructor(
		typeName: TypeName | undefined,
		constructSignatures: ConstructSignature[],
		properties: ClassProperty[],
		methods: ClassMethod[],
		typeParameters?: TypeName[],
	) {
		this.typeName = typeName;
		this.constructSignatures = constructSignatures;
		this.properties = properties;
		this.methods = methods;
		this.typeParameters = typeParameters;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}
		return 'class';
	}
}

export class ConstructSignature {
	constructor(
		public parameters: Parameter[],
		public documentation: Documentation | undefined,
	) {}

	toString(): string {
		return `new (${this.parameters.map((p) => p.toString()).join(', ')})`;
	}
}

export class ClassProperty {
	constructor(
		public name: string,
		public type: AnyType,
		public documentation: Documentation | undefined,
		public optional: boolean,
		public readonly: boolean,
		public isStatic: boolean = false,
	) {}

	toString(): string {
		const staticPrefix = this.isStatic ? 'static ' : '';
		const readonlyPrefix = this.readonly ? 'readonly ' : '';
		const optionalSuffix = this.optional ? '?' : '';
		return `${staticPrefix}${readonlyPrefix}${this.name}${optionalSuffix}: ${this.type.toString()}`;
	}
}

export class ClassMethod {
	/** All call signatures (overloads) for this method */
	callSignatures: CallSignature[];

	constructor(
		public name: string,
		callSignatures: CallSignature[],
		public documentation: Documentation | undefined,
		public isStatic: boolean = false,
	) {
		this.callSignatures = callSignatures;
	}

	toString(): string {
		const staticPrefix = this.isStatic ? 'static ' : '';
		if (this.callSignatures.length === 0) {
			return `${staticPrefix}${this.name}()`;
		}
		return this.callSignatures
			.map((sig) => `${staticPrefix}${this.name}${sig.toString()}`)
			.join(' | ');
	}
}
