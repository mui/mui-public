import * as React from 'react';
import { TypesAlertDialogTrigger, TypesAlertDialogClose } from './types';

export function TypesAlertDialog() {
  return (
    <div>
      <h3>Alert Dialog API</h3>
      <h3>Trigger</h3>
      <TypesAlertDialogTrigger />
      <h3>Close</h3>
      <TypesAlertDialogClose />
    </div>
  );
}
