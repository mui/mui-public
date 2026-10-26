import type * as React from 'react';

type SharedProps<Value> = { value: Value };

export const SharedTypeParametersComponent: (<Value extends string>(
	props: SharedProps<Value> & { multiple?: false },
) => React.ReactNode) &
	(<Value extends string>(props: SharedProps<Value[]> & { multiple: true }) => React.ReactNode) =
	null!;

export declare const SharedUnionComponent:
	| (<Value extends string>(props: SharedProps<Value> & { multiple?: false }) => React.ReactNode)
	| (<Value extends string>(props: SharedProps<Value[]> & { multiple: true }) => React.ReactNode);

export declare const RenamedUnionComponent:
	| (<Value>(props: { value: Value }) => React.ReactNode)
	| (<Item>(props: { items: Item[] }) => React.ReactNode);
