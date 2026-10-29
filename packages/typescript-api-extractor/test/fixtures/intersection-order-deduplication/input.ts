/**
 * Tests that intersection multiset matching is order-independent.
 *
 * Case 1 (IntersectionOrderIndependent): Two overloads whose parameter is the same
 * intersection with members in different order (`A & B` vs `B & A`).
 * Should collapse to 1 member.
 *
 * Case 2 (IntersectionNotEquivalent): Two overloads with genuinely different
 * intersections (`A & B` vs `A & C`). Must NOT collapse.
 */

interface A {
	a: string;
}

interface B {
	b: number;
}

interface C {
	c: boolean;
}

export type IntersectionOrderIndependent = ((x: A & B) => void) | ((x: B & A) => void);

export type IntersectionNotEquivalent = ((x: A & B) => void) | ((x: A & C) => void);
