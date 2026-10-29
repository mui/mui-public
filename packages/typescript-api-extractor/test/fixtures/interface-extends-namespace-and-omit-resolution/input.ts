import type * as React from 'react';

// Base types (simulating Dialog types)
export interface DialogRootProps<Payload = unknown> {
	open?: boolean;
	defaultOpen?: boolean;
	modal?: boolean;
	disablePointerDismissal?: boolean;
	onOpenChange?: (open: boolean, details: DialogRootChangeEventDetails) => void;
	children?: React.ReactNode | ((state: { payload: Payload | undefined }) => React.ReactNode);
}

export interface DialogRootActions {
	unmount(): void;
	close(): void;
}

export type DialogRootChangeEventReason = 'click' | 'escape' | 'focus-out';

export interface DialogRootChangeEventDetails {
	reason: DialogRootChangeEventReason;
	preventUnmountOnClose(): void;
}

// Namespace export pattern (like DialogRoot)
export namespace DialogRoot {
	export type Props<Payload = unknown> = DialogRootProps<Payload>;
	export type Actions = DialogRootActions;
	export type ChangeEventReason = DialogRootChangeEventReason;
	export type ChangeEventDetails = DialogRootChangeEventDetails;
}

// ==========================================
// AlertDialog types extending Dialog types
// ==========================================

// Pattern 1: Extends with Omit (removing some props and redefining them)
export interface AlertDialogRootProps<Payload = unknown> extends Omit<
	DialogRoot.Props<Payload>,
	'modal' | 'disablePointerDismissal' | 'onOpenChange'
> {
	/**
	 * Event handler called when the dialog is opened or closed.
	 */
	onOpenChange?: (open: boolean, details: AlertDialogRoot.ChangeEventDetails) => void;
}

// Pattern 2: Simple type alias assignment (direct re-export of base type)
export type AlertDialogRootActions = DialogRoot.Actions;

// Pattern 3: Simple type alias assignment
export type AlertDialogRootChangeEventReason = DialogRoot.ChangeEventReason;

// Pattern 4: Intersection type extending base with additional properties
export type AlertDialogRootChangeEventDetails = DialogRoot.ChangeEventDetails & {
	/**
	 * Additional alert-specific detail
	 */
	alertLevel: 'info' | 'warning' | 'error';
};

// Namespace export pattern (like AlertDialogRoot)
export namespace AlertDialogRoot {
	export type Props<Payload = unknown> = AlertDialogRootProps<Payload>;
	export type Actions = AlertDialogRootActions;
	export type ChangeEventReason = AlertDialogRootChangeEventReason;
	export type ChangeEventDetails = AlertDialogRootChangeEventDetails;
}
