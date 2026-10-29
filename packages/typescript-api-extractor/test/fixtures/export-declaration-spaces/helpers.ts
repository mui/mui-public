export type ReexportedAlias = 'reexported';

export const reexportedValue = 'reexported';

export class ReexportedClass {
	id: string = 'class';
}

export function mergedTarget(): string {
	return 'merged-target';
}

export function typeOnlyImported(): string {
	return 'type-only-imported';
}
