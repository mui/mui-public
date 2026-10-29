import * as React from 'react';

export function GenericFunctionComponent<Value>(props: { value: Value }) {
	return <div>{String(props.value)}</div>;
}

export const ConstrainedComponent = <Key extends string, Value = unknown>(
	props: ConstrainedComponentProps<Key, Value>,
) => {
	return <div>{props.keys.join(', ')}</div>;
};

interface ConstrainedComponentProps<Key extends string, Value> {
	keys: Key[];
	values?: Record<Key, Value>;
}

export function NonGenericComponent(props: { label: string }) {
	return <div>{props.label}</div>;
}
