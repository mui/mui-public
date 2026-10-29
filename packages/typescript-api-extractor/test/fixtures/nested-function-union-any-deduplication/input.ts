/**
 * Higher-order edge case: outer function parameters are unions of function
 * types, and one outer overload uses `any` directly as a parameter type.
 *
 * Note: TypeScript simplifies `((y: any) => void) | ((y: string) => void)` to
 * just `(y: string) => void` at the type level (the any-variant absorbs the
 * string-variant). So to test nested function-union matching with wildcard any,
 * we use `any` at the outer parameter level instead.
 *
 * Case 1 (CollapseViaAny): One outer overload has (x: any) => void which
 *   matches (x: ((y: string) => void) | ((y: number) => void)) => void
 *   via the any wildcard. Should collapse to 1 (preferring the concrete one).
 *
 * Case 2 (NestedUnionReorder): Two overloads with identical inner union
 *   members in different order. Should collapse to 1 member.
 *
 * Case 3 (NotEquivalent): Two overloads with genuinely different inner
 *   union members. Must stay 2 members.
 */

// Should collapse: any wildcard matches the concrete union parameter
export type CollapseViaAny =
	((x: any) => void) | ((x: ((y: string) => void) | ((y: number) => void)) => void);

// Should collapse: same inner union, different member order
export type NestedUnionReorder =
	| ((x: ((y: string) => void) | ((y: number) => void)) => void)
	| ((x: ((y: number) => void) | ((y: string) => void)) => void);

// Must NOT collapse: genuinely different inner unions
export type NotEquivalent =
	| ((x: ((y: string) => void) | ((y: boolean) => void)) => void)
	| ((x: ((y: string) => void) | ((y: number) => void)) => void);
