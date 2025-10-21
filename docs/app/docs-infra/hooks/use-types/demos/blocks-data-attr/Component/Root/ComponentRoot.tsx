import * as React from 'react';

export interface ComponentRootState {
  /** Whether the component is disabled */
  disabled: boolean;
  /** Whether the component is active */
  active: boolean;
}

export interface ComponentRootProps {
  /** The title to display */
  title: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Child elements */
  children?: React.ReactNode;
}

/**
 * A simple component that displays a title and optional children.
 */
export function ComponentRoot(props: ComponentRootProps) {
  const handleClick = (event: React.MouseEvent) => {
    console.warn('Clicked', event);
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
}
