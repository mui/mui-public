import * as React from 'react';
import { TypesComponentPart, TypesComponentRoot } from './types';

export function TypesComponent() {
  return (
    <div>
      <h3>ComponentRoot</h3>
      <TypesComponentRoot />
      <h3>ComponentPart</h3>
      <TypesComponentPart />
    </div>
  );
}
