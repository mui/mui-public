import * as React from 'react';

export const DemoRootContext = React.createContext<React.RefObject<HTMLDivElement | null> | null>(
  null,
);
