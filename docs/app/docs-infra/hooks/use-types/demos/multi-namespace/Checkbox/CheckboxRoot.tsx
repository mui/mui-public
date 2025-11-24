import * as React from 'react';

export interface CheckboxRootState {
  /** Whether the checkbox is currently checked */
  checked: boolean;
}

export interface CheckboxRootProps {
  /**
   * Whether the checkbox is checked.
   */
  checked?: boolean;
  /**
   * Whether the checkbox is indeterminate.
   */
  indeterminate?: boolean;
}

export enum CheckboxRootCssVars {
  /**
   * The checkbox's background color.
   * @type {string}
   */
  checkboxBackgroundColor = '--checkbox-background-color',
  /**
   * The checkbox's border color.
   * @type {string}
   */
  checkboxBorderColor = '--checkbox-border-color',
}

/**
 * The foundational Checkbox component.
 */
export function CheckboxRoot(_props: CheckboxRootProps): React.JSX.Element {
  return <input type="checkbox" />;
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- Using namespace for type grouping
export namespace CheckboxRoot {
  export type State = CheckboxRootState;
  export type Props = CheckboxRootProps;
  export type CssVars = CheckboxRootCssVars;
}
