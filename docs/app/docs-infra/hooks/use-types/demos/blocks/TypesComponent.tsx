import * as React from 'react';
import { TypesComponent as ComponentTypes } from './types';

export function TypesComponent() {
  return (
    <div>
      {/* @focus-start */}
      <h3>ComponentRoot</h3>
      <ComponentTypes.Root />
      <h3>ComponentPart</h3>
      <ComponentTypes.Part />
      {/* @focus-end */}
    </div>
  );
}
