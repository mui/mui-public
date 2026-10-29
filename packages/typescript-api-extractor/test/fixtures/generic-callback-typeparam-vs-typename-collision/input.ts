/**
 * Mixed nested TypeParameterNode vs non-type-parameter name collisions.
 *
 * The type parameter name `T` in one variant collides with the external
 * type name `T` used in the constraint of the other. The structural
 * comparison must distinguish a TypeParameterNode reference from a
 * concrete type reference that happens to share the same name.
 *
 * Case 1 (Colliding): `T` is a type param in the first variant and a
 *   concrete interface name in the constraint of the second.  Both
 *   variants must be preserved.
 *
 * Case 2 (AlphaEquiv): Both variants are truly alpha-equivalent
 *   (only type param names differ), so they should be deduplicated.
 */
interface T {
	value: number;
}

// NOT equivalent: first variant's constraint references its own type param T,
// second variant's constraint references the concrete interface T.
export type Colliding = (<T extends { self: T }>(x: T) => T) | (<U extends { self: T }>(x: U) => U);

// Alpha-equivalent: both reference the concrete interface T in constraints,
// differing only in type param naming (A vs B). Should deduplicate.
export type AlphaEquiv = (<A extends { ref: T }>(x: A) => A) | (<B extends { ref: T }>(x: B) => B);
