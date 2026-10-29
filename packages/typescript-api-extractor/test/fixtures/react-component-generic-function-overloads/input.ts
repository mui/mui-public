import type * as React from 'react';

export function GenericOverloadedComponent<Value>(props: Props1<Value>): React.ReactNode;
export function GenericOverloadedComponent<Value>(props: Props2<Value>): React.ReactNode;
export function GenericOverloadedComponent<Value>(
	props: Props1<Value> | Props2<Value>,
): React.ReactNode {
	return null;
}

interface Props1<Value> {
	discriminant?: false | undefined;
	variant1Prop: Value;
	variant1OptionalProp?: Value;
	mandatoryProp: Value;
}

interface Props2<Value> {
	discriminant: true;
	variant2Prop: Value;
	variant2OptionalProp?: Value;
	mandatoryProp: Value;
}
