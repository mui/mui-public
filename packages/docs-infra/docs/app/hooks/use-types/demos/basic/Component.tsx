import React from 'react';

interface Props {
  /** The title to display */
  title: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Child elements */
  children?: React.ReactNode;
}

/**
 * My Component - A simple component that displays a title and optional children.
 */
export function MyComponent(props: Props) {
  const handleClick = (event: React.MouseEvent) => {
    console.log('Clicked', event);
  };

  return (
    <div onClick={handleClick}>
      {props.title}
      {props.children}
    </div>
  );
}
