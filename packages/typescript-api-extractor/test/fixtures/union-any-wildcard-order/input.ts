/**
 * Tests that union/intersection multiset matching is order-independent.
 *
 * Case 1 (OrderIndependent): Two overloads whose parameter is the same union
 * with members in different order (`string | number` vs `number | string`).
 * Should collapse to 1 member.
 *
 * Case 2 (AnyWildcardDedup): One overload has `any` parameter (TypeScript
 * simplifies `any | string` to `any`), the other has `string | number`.
 * The `any` wildcard matches a concrete type, so they collapse to 1 member
 * (the non-any version is preferred).
 *
 * Case 3 (NotEquivalent): Two overloads with genuinely different unions
 * (`string | number` vs `string | boolean`). Must NOT collapse.
 */

// Should collapse: same union, different member order.
export type OrderIndependent = ((x: string | number) => void) | ((x: number | string) => void);

// Should collapse: any matches string | number via wildcard.
export type AnyWildcardDedup = ((x: any | string) => void) | ((x: string | number) => void);

// Same as above but concrete overload first — must also collapse to 1 member.
// Regression test: right-side wildcard must not be greedily consumed.
export type AnyWildcardDedupReversed = ((x: string | number) => void) | ((x: any | string) => void);

// Must NOT collapse: different union members.
export type NotEquivalent = ((x: string | number) => void) | ((x: string | boolean) => void);
