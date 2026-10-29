import * as React from 'react';

export interface DialogTriggerProps {
	/**
	 * The content of the trigger button.
	 */
	children?: React.ReactNode;
	/**
	 * Whether the trigger is disabled.
	 */
	disabled?: boolean;
}

/**
 * A button that opens the dialog.
 */
export function DialogTrigger(props: DialogTriggerProps): React.JSX.Element {
	const { children, disabled } = props;
	return <button disabled={disabled}>{children}</button>;
}

export namespace DialogTrigger {
	export interface Props extends DialogTriggerProps {}
}
