import type { Documentation } from '../documentation';
import type { AnyType, TypeNode } from '../node';
import type { TypeName } from '../typeName';
import type { TypeParameterNode } from './typeParameter';

export class FunctionNode implements TypeNode {
  readonly kind = 'function';
  declare typeName: TypeName | undefined;
  declare callSignatures: CallSignature[];

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
