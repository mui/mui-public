import * as React from 'react';
import { getButtonLabel } from './helper';

export default function BasicButtons() {
  const id: string = React.useId();

  return (
    <button id={id} type="button">
      {getButtonLabel()}
    </button>
  );
}
