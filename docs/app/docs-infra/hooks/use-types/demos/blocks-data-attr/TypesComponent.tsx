import * as React from 'react';
import { TypesComponentRoot, TypesComponentPart, TypesComponentAdditional } from './types';

export function TypesComponent() {
  return (
    <div>
      <h3>Component API</h3>
      <h3>Root</h3>
      <TypesComponentRoot />
      <h3>Part</h3>
      <TypesComponentPart />
      <h3>Additional Types</h3>
      <TypesComponentAdditional />
    </div>
  );
}
