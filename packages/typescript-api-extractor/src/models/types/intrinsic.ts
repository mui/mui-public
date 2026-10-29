import type { TypeNode } from '../node';
import type { TypeName } from '../typeName';

type IntrinsicType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'symbol'
  | 'null'
  | 'undefined'
  | 'void'
  | 'never'
  | 'any'
  | 'unknown'
  | 'function';

export class IntrinsicNode implements TypeNode {
  readonly kind = 'intrinsic';
  declare typeName: TypeName | undefined;
  declare intrinsic: IntrinsicType;

  constructor(intrinsic: IntrinsicType, typeName: TypeName | undefined = undefined) {
    this.typeName = typeName?.name ? typeName : undefined;
    this.intrinsic = intrinsic;
  }

  toString(): string {
    if (this.typeName) {
      return this.typeName.toString();
    }

    return this.intrinsic;
  }
}
