/**
 * Union of generic callbacks where one constraint is an alias and the other
 * is an inline object with identical structure. The alias identity should
 * prevent deduplication even though the shapes match.
 */
type Foo = { a: string };
export type Fn = (<T extends Foo>() => T) | (<U extends { a: string }>() => U);
