import * as React from 'react';

export const TestComponent1 = function TestComponent(props: Props): React.ReactElement {
	return <div {...props} />;
};

export const TestComponent2: React.FC<Props> = function TestComponent2(
	props: Props,
): React.ReactElement {
	return <div {...props} />;
};

export const TestComponent3: React.FunctionComponent<Props> = function TestComponent2(
	props: Props,
): React.ReactElement {
	return <div {...props} />;
};

interface Props {
	className?: string;
	id?: string;
}
