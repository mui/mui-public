import type * as React from 'react';

export function genericFunction<T extends React.HTMLAttributes<HTMLElement>>(
	params: GenericFunctionParameters<T>,
): T {
	return params.value;
}

interface GenericFunctionParameters<T extends React.HTMLAttributes<HTMLElement>> {
	value: T;
	nestedGenericType: GenericInterface<GenericInterface<string>>;
}

interface GenericInterface<T> {
	data: T;
}
