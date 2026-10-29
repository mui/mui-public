export function Button(): string {
	return 'button';
}

export namespace Button {
	export type Size = 'small' | 'large';
}

export * as ButtonDataAttributes from './attributes';
