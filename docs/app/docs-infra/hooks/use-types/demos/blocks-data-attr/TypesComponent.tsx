import * as React from 'react';
import { TypesComponent as ComponentTypes, TypesComponentAdditional } from './types';

export function TypesComponent() {
  return (
    <div>
      <h3>Component API</h3>
      <h3>Root</h3>
      <ComponentTypes.Root />
      <h3>Part</h3>
      <ComponentTypes.Part />
      <h3>Additional Types</h3>
      <TypesComponentAdditional />
    </div>
  );
}
