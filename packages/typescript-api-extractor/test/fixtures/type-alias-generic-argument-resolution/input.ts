export function f(x: Params) {}

interface Params {
	a: Generic<Alias>;
}

interface Generic<T> {
	value: T;
}

interface Obj {
	x: number;
}

type Alias = Obj;
