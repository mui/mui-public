export function acceptsArrayProps(params: Params) {}

export function acceptsArrayParameters(a1: Array<string>, a2: number[]) {}

interface Params {
	arr1: Array<string>;
	arr2: number[];
	optionalArr1?: Array<string>;
	optionalArr2?: number[];
}
