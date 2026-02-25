import * as React from 'react';
import { InputType } from '../../InputType';

export interface ComponentPartState {
  /** Whether the part is visible */
  visible: boolean;
  /** Whether the part is expanded */
  expanded: boolean;
}

export interface ComponentPartProps {
  /** The title to display */
  title: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  input?: InputType;
  /** Child elements */
  children?: React.ReactNode;
}

/**
 * A simple component that displays a title and optional children.
 */
export function ComponentPart(props: ComponentPartProps) {
  const handleClick = (event: React.MouseEvent) => {
    console.warn('Clicked', event, props.input);
  };

  return (
    <button type="button" onClick={handleClick}>
      {props.title}
      {!props.disabled ? props.children : null}
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- Using namespace for type grouping as per Base UI convention
export namespace ComponentPart {
  export type State = ComponentPartState;
  export type Props = ComponentPartProps;
}
