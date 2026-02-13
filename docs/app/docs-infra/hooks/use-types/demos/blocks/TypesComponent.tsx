import * as React from 'react';
import { TypesComponent as ComponentTypes } from './types';

export function TypesComponent() {
  return (
    <div>
      <h3>ComponentRoot</h3>
      <ComponentTypes.Root />
      <h3>ComponentPart</h3>
      <ComponentTypes.Part />
    </div>
  );
}
