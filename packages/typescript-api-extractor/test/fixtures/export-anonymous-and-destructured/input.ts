const helpers = {
	helper: (value: number) => value * 2,
	nested: { label: 'label' as const },
};

// Bindings of a destructuring declaration are exported values like any other.
export const {
	helper,
	nested: { label },
} = helpers;

/**
 * A default function without a name.
 */
export default function (value: string): number {
	return value.length;
}

// A default class without a name, reached through a namespace re-export.
export * as Anonymous from './anonymous-class';
