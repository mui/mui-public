import * as React from 'react';

export interface DialogTriggerProps {
  /**
   * CSS class applied to the trigger element.
   * Can be a string or a function that receives the state.
   */
  className?: string | ((state: DialogTriggerState) => string);
  /**
   * Whether the trigger is disabled.
   */
  disabled?: boolean;
  /**
   * Child elements.
   */
  children?: React.ReactNode;
}

export interface DialogTriggerState {
  /**
   * Whether the dialog is currently open.
   */
  open: boolean;
  /**
   * Whether the trigger is disabled.
   */
  disabled: boolean;
}

/**
 * A button that opens the dialog.
 * Renders a `<button>` element.
 */
// eslint-disable-next-line import/export
export const DialogTrigger = React.forwardRef(function DialogTrigger(
  props: DialogTriggerProps,
  ref: React.ForwardedRef<HTMLButtonElement>,
) {
  const { className, disabled, children, ...other } = props;

  const state: DialogTriggerState = React.useMemo(
    () => ({
      open: false,
      disabled: disabled ?? false,
    }),
    [disabled],
  );

  const computedClassName = typeof className === 'function' ? className(state) : className;

  return (
    <button type="button" ref={ref} className={computedClassName} disabled={disabled} {...other}>
      {children}
    </button>
  );
});

// eslint-disable-next-line @typescript-eslint/no-namespace, import/export
export namespace DialogTrigger {
  export type Props = DialogTriggerProps;
  export type State = DialogTriggerState;
}
