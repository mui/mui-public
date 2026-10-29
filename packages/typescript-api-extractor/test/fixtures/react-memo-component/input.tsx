import * as React from 'react';

/**
 * A test component
 */
export const TestComponent = React.memo<Props>(function TestComponent(props: Props) {
	return <div {...props} />;
});

interface Props {
	className?: string;
	id?: string;
}
