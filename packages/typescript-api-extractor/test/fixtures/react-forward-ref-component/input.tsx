import * as React from 'react';

/**
 * A test component
 */
export const TestComponent = React.forwardRef(function TestComponent(
	props: Props,
	ref: React.ForwardedRef<HTMLDivElement>,
) {
	return <div {...props} ref={ref} />;
});

interface Props {
	className?: string;
	id?: string;
}
