/**
 * Nested generic function types where inner signatures reuse the same
 * type parameter name as an outer mapping. Inner T should shadow outer T
 * and not incorrectly resolve via the outer rename map.
 */
export type Outer =
	| (<T extends string>(fn: <T extends number>(x: T) => T) => T)
	| (<U extends string>(fn: <U extends number>(x: U) => U) => U);
