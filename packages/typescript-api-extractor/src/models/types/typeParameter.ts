import { AnyType } from '../node';

export class TypeParameterNode {
	readonly kind = 'typeParameter';

	constructor(
		public name: string,
		public constraint: AnyType | undefined,
		public defaultValue: AnyType | undefined,
	) {}

	toString(): string {
		return this.name;
	}
}
