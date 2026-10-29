export function testFunction1(): [string, number] {
	return ['hello', 42];
}

export function testFunction2(): [s: string, n: number] {
	return ['hello', 42];
}

export function testFunction3(): TupleType {
	return ['hello', 42];
}

export function testFunction4(): NamedTupleType {
	return ['hello', 42];
}

type TupleType = [string, number];

type NamedTupleType = [s: string, n: number];
