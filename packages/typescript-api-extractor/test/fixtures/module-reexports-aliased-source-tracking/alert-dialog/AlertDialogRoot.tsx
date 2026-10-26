import * as React from 'react';

export interface AlertDialogRootProps {
	/**
	 * Whether the dialog is open.
	 */
	open?: boolean;
	/**
	 * Callback when the open state changes.
	 */
	onOpenChange?: (open: boolean) => void;
	/**
	 * Child elements.
	 */
	children?: React.ReactNode;
}

/**
 * The root component for an alert dialog.
 */
export function AlertDialogRoot(props: AlertDialogRootProps): React.JSX.Element {
	const { children } = props;
	return <div role="alertdialog">{children}</div>;
}

export namespace AlertDialogRoot {
	export interface Props extends AlertDialogRootProps {}
}
