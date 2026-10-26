export function acceptsGenericAlias(a: GenericObject<MyUnion>) {
	return null;
}

type GenericObject<T> = {
	x: T;
};

type MyUnion = string | number;
