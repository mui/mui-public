import { TypeNode } from '../node';
import { TypeName } from '../typeName';

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
	typeName: TypeName | undefined;
	intrinsic: IntrinsicType;

	constructor(intrinsic: IntrinsicType, typeName: TypeName | undefined = undefined) {
		this.intrinsic = intrinsic;
		this.typeName = typeName?.name ? typeName : undefined;
	}

	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		return this.intrinsic;
	}
}
