import * as React from 'react';
import type { ComponentPartState } from '../Part/ComponentPart';

export interface ComponentRootState {
  /** Whether the component is disabled */
  disabled: boolean;
  /** Whether the component is active */
  active: boolean;
}

export interface ComponentRootChangeEventDetails {
  /** The previous state */
  previousState: ComponentRootState;
  /** The new state */
  newState: ComponentRootState;
}

export interface ComponentRootProps {
  /** The title to display */
  title: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Child elements */
  children?: React.ReactNode;
  /**
   * Callback fired when the state changes.
   * Receives the event details containing previous and new states.
   */
  onStateChange?: (details: ComponentRootChangeEventDetails) => void;
  /**
   * Optional state from the Part component.
   * This demonstrates cross-component type references.
   */
  partState?: ComponentPartState;
}

/**
 * A simple component that displays a title and optional children.
 */
export function ComponentRoot(props: ComponentRootProps) {
  const handleClick = (event: React.MouseEvent) => {
    console.warn('Clicked', event);

    if (props.onStateChange) {
      props.onStateChange({
        previousState: { disabled: false, active: false },
        newState: { disabled: !!props.disabled, active: true },
      });
    }

    if (props.partState) {
      console.warn('Part state:', props.partState);
    }
  };

  return (
    <button type="button" onClick={handleClick}>
      {props.title}
      {!props.disabled ? props.children : null}
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- Using namespace for type grouping as per Base UI convention
export namespace ComponentRoot {
  export type State = ComponentRootState;
  export type Props = ComponentRootProps;
  export type ChangeEventDetails = ComponentRootChangeEventDetails;
}
