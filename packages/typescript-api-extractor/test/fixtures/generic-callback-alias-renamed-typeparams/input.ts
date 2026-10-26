/**
 * Aliased function types whose type arguments reference renamed method-level
 * type parameters. The two branches should be deduplicated because they are
 * alpha-equivalent: Callback<T> ≡ Callback<U> when T and U occupy the same
 * position and carry the same constraint.
 */
type Callback<V> = (value: V) => void;

export type AlphaEquivAlias = (<T>(x: T) => Callback<T>) | (<U>(x: U) => Callback<U>);

/**
 * Same scenario but with constrained type parameters.
 */
export type AlphaEquivAliasConstrained =
	(<T extends string>(x: T) => Callback<T>) | (<U extends string>(x: U) => Callback<U>);

/**
 * Non-equivalent: different constraints mean the branches should NOT deduplicate.
 */
export type NonEquivAliasDifferentConstraints =
	(<T extends string>(x: T) => Callback<T>) | (<U extends number>(x: U) => Callback<U>);
