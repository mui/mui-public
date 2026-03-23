import * as React from 'react';
import { DialogTrigger } from '../Dialog/DialogTrigger';

export interface AlertDialogTriggerProps {
  /**
   * CSS class applied to the trigger element.
   * Can be a string or a function that receives the state.
   */
  className?: string | ((state: AlertDialogTriggerState) => string);
  /**
   * Whether the trigger is disabled.
   */
  disabled?: boolean;
  /**
   * Child elements.
   */
  children?: React.ReactNode;
}

export interface AlertDialogTriggerState extends DialogTrigger.State {
  /**
   * Whether the alert requires user acknowledgment.
   */
  requiresAcknowledgment: boolean;
}

/**
 * A button that opens the alert dialog.
 * Renders a `<button>` element.
 */
// eslint-disable-next-line import/export
export const AlertDialogTrigger = React.forwardRef(function AlertDialogTrigger(
  props: AlertDialogTriggerProps,
  ref: React.ForwardedRef<HTMLButtonElement>,
) {
  return <DialogTrigger ref={ref} {...(props as DialogTrigger.Props)} />;
});

// eslint-disable-next-line @typescript-eslint/no-namespace, import/export
export namespace AlertDialogTrigger {
  export type Props = AlertDialogTriggerProps;
  export type State = AlertDialogTriggerState;
}
