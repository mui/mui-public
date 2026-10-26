import * as React from 'react';

export interface DialogBackdropProps {
	/**
	 * Custom CSS class for the backdrop.
	 */
	className?: string;
}

/**
 * An overlay that covers the page behind the dialog.
 */
export function DialogBackdrop(props: DialogBackdropProps): React.JSX.Element {
	const { className } = props;
	return <div className={className} />;
}

export namespace DialogBackdrop {
	export interface Props extends DialogBackdropProps {}
}
