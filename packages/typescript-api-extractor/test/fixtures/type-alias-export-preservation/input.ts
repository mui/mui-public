export type SimpleAlias = string;

export type UnionAlias = 'a' | 'b' | 'c';

export type ObjectAlias = {
	name: string;
	age: number;
};

export type GenericAlias<T> = {
	value: T;
	isValid: boolean;
};

export type ConditionalAlias<T> = T extends string ? 'string' : 'other';

interface BaseInterface {
	id: string;
}

export type ExtendedAlias = BaseInterface & {
	extra: boolean;
};

// Test that type aliases are preserved when used in function parameters
export function processWithUnionAlias(mode: UnionAlias): string {
	return mode;
}

export function processWithObjectAlias(obj: ObjectAlias): string {
	return obj.name;
}
