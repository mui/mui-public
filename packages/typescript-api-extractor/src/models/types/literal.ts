import type { TypeNode } from '../node';
import type { Documentation } from '../documentation';
import type { TypeName } from '../typeName';

export class LiteralNode implements TypeNode {
  readonly kind = 'literal';
  declare public value: unknown;
  declare public typeName: TypeName | undefined;
  declare public documentation?: Documentation;

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
