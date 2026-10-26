import type { PropertyNode } from './object';
import type { TypeNode } from '../node';
import type { TypeName } from '../typeName';
import type { TypeParameterNode } from './typeParameter';

export class ComponentNode implements TypeNode {
  readonly kind = 'component';
  declare public typeName: TypeName | undefined;
  declare public props: PropertyNode[];
  declare public typeParameters: TypeParameterNode[] | undefined;

  constructor(
    typeName: TypeName | undefined,
    props: PropertyNode[],
    typeParameters?: TypeParameterNode[],
  ) {
    this.props = props;
    this.typeName = typeName?.name ? typeName : undefined;
    this.typeParameters = typeParameters?.length ? typeParameters : undefined;
  }

  toString() {
    if (this.typeName) {
      return this.typeName.toString();
    }

    return '';
  }
}
