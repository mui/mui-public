import * as React from 'react';

interface Props {
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
export function ComponentRoot(props: Props) {
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
