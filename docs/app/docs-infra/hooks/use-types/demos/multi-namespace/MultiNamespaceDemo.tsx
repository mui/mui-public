import * as React from 'react';
import { TypesButton, TypesCheckbox } from './types';

export function MultiNamespaceDemo() {
  return (
    <div>
      <h3>Button</h3>
      <TypesButton />

      <h3>Checkbox</h3>
      <TypesCheckbox />
    </div>
  );
}
