/**
 * Tests that generic functions with different type parameter constraints
 * are not incorrectly collapsed by the toString() fast-path.
 * TypeParameterNode.toString() returns only the name (e.g. "T"), omitting
 * constraints and defaults, so `<T>(x: T) => void` and
 * `<T extends string>(x: T) => void` stringify identically.
 * Both overloads must be preserved.
 */

// Different constraints on the type parameter: unconstrained vs `extends string`.
export type Fn = (<T>(x: T) => void) | (<T extends string>(x: T) => void);

// Nested as parameters of an outer function — the inner generic callbacks
// have different constraints but identical toString() representations.
export type Outer =
	((cb: <T>(x: T) => void) => void) | ((cb: <T extends string>(x: T) => void) => void);
