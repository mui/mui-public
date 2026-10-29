import type { Documentation } from '../documentation';
import type { TypeNode } from '../node';
import type { TypeName } from '../typeName';

export class EnumNode implements TypeNode {
  readonly kind = 'enum';

  constructor(
    public typeName: TypeName,
    public members: EnumMember[],
    public documentation: Documentation | undefined,
  ) {}

  toString(): string {
    return this.typeName.toString();
  }
}

export class EnumMember {
  constructor(
    public name: string,
    /** The member's value: a string or number, or none for a member computed at runtime. */
    public value: string | number | undefined,
    public documentation: Documentation | undefined,
  ) {}
}
