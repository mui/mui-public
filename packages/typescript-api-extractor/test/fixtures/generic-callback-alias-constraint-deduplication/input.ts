/**
 * Union of generic callbacks whose constraints are different type aliases
 * with identical structure. The aliases (Foo vs Bar) should prevent
 * deduplication even though the underlying shape is the same.
 */
type Foo = { a: string };
type Bar = { a: string };
export type Fn = (<T extends Foo>() => T) | (<U extends Bar>() => U);
