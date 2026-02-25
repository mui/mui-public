import * as React from 'react';
import type { DialogTriggerState } from './DialogTrigger';

export interface DialogCloseProps {
  /**
   * Render function that receives the trigger state.
   * This demonstrates a component depending on another component's state type.
   */
  render?: (triggerState: DialogTriggerState) => React.ReactNode;
  /**
   * Child elements.
   */
  children?: React.ReactNode;
}

/**
 * A button that closes the dialog.
 * Renders a `<button>` element.
 */
// eslint-disable-next-line import/export
export const DialogClose = React.forwardRef(function DialogClose(
  props: DialogCloseProps,
  ref: React.ForwardedRef<HTMLButtonElement>,
) {
  const { render, children, ...other } = props;

  // In a real implementation, triggerState would come from context
  const triggerState: DialogTriggerState = { open: true, disabled: false };

  return (
    <button type="button" ref={ref} {...other}>
      {render ? render(triggerState) : children}
    </button>
  );
});

// eslint-disable-next-line @typescript-eslint/no-namespace, import/export
export namespace DialogClose {
  export type Props = DialogCloseProps;
}
