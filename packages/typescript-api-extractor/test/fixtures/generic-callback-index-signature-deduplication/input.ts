/**
 * Union of generic callbacks whose constraints are objects with differing
 * index signatures. These should NOT be deduplicated.
 */
export type Fn =
	(<T extends { [k: string]: number }>() => T) | (<U extends { [k: string]: string }>() => U);
