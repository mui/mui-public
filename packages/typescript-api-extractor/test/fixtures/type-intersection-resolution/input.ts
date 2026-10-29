export function inlineIntersection(a: A & B) {}
export function aliasedIntersection(a: AB) {}
export function intersectionWithMethod(a: WithMethod) {}

interface A {
	a: string;
	b: number;
}

interface B {
	a?: string;
	c?: number;
}

type AB = A & B;

type WithMethod = A & {
	doSomething(): void;
};
