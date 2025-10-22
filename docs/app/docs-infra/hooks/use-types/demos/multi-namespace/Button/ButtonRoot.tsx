import * as React from 'react';

export interface ButtonRootState {
  /** Whether the button is currently pressed */
  pressed: boolean;
}

export interface ButtonRootProps {
  /**
   * The button variant style.
   */
  variant?: 'primary' | 'secondary';
  /**
   * Whether the button is disabled.
   */
  disabled?: boolean;
}

/**
 * CSS Variables for the Button component.
 */
export enum ButtonRootCssVars {
  /**
   * The button's background color.
   * @type {string}
   */
  buttonBackgroundColor = '--button-background-color',
  /**
   * The button's text color.
   * @type {string}
   */
  buttonTextColor = '--button-text-color',
}

export enum ButtonRootTemp {
  test = 'a',
  /**
   * testing!
   */
  test2 = 'b',
}

/**
 * The foundational Button component.
 */
export function ButtonRoot(_props: ButtonRootProps): React.JSX.Element {
  return <button type="button" />;
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- Using namespace for type grouping
export namespace ButtonRoot {
  export type State = ButtonRootState;
  export type Props = ButtonRootProps;
  export type CssVars = ButtonRootCssVars;
  export type Temp = ButtonRootTemp;
}
