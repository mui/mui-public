import type * as React from 'react';

/**
 * A hook defined as a function expression.
 *
 * @internal
 */
export const useHook = function useHook(parameters: HookParameters): HookReturnValue {
	return {
		getProps(externalProps) {
			return externalProps;
		},
		ref(element: HTMLElement) {},
	};
};

interface HookParameters {
	value: string;
	severity: number;
	onChange: (value: string) => void;
}

interface HookReturnValue {
	getProps: (externalProps: React.HTMLAttributes<HTMLElement>) => React.HTMLAttributes<HTMLElement>;
	ref: React.RefCallback<HTMLElement>;
}
