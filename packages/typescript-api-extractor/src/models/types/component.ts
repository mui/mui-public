import { PropertyNode } from './object';
import { TypeNode } from '../node';
import { TypeName } from '../typeName';
import { TypeParameterNode } from './typeParameter';

export class ComponentNode implements TypeNode {
	readonly kind = 'component';
	public typeName: TypeName | undefined;
	public props: PropertyNode[];
	public typeParameters: TypeParameterNode[] | undefined;

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
