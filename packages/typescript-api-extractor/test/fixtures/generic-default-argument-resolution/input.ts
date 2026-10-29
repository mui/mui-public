export function defaultParam(x: Params) {}
export function stringParam(x: Params<string>) {}
export function numberParam(x: Params<number>) {}
export function genericParam<T>(x: Params<T>) {}

export function defaultPair(x: Params2<string, number>) {}
export function stringPair(x: Params2<string, string>) {}
export function numberPair(x: Params2<number, number>) {}

export function partialStringPair(x: Params2<string>) {}
export function partialNumberPair(x: Params2<number>) {}

interface Params<T = string> {
	v: T;
}

interface Params2<T = string, U = number> {
	v: T;
	u: U;
}
