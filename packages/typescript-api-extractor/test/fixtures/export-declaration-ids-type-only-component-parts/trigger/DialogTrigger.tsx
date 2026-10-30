import * as React from 'react';

export interface DialogTriggerState {
	/** Whether the dialog is open. */
	open: boolean;
}

export interface DialogTriggerProps<Payload = unknown> {
	/** The payload passed to the dialog when it opens. */
	payload?: Payload;
	/** Returns the class name for the current state. */
	className?: (state: DialogTriggerState) => string;
}

/**
 * Opens the dialog.
 */
export const DialogTrigger = React.forwardRef(function DialogTrigger(
	props: DialogTriggerProps,
	ref: React.ForwardedRef<HTMLButtonElement>,
) {
	return <button type="button" ref={ref} className={props.className?.({ open: false })} />;
}) as DialogTrigger;

export interface DialogTrigger {
	<Payload>(props: DialogTrigger.Props<Payload>): React.JSX.Element;
}

export namespace DialogTrigger {
	export type Props<Payload = unknown> = DialogTriggerProps<Payload>;
	export type State = DialogTriggerState;
}
