import * as React from 'react';
import { TypesAlertDialog as AlertDialogTypes } from './types';

export function TypesAlertDialog() {
  return (
    <div>
      {/* @highlight-start @focus */}
      <h3>Alert Dialog API</h3>
      <h3>Trigger</h3>
      <AlertDialogTypes.Trigger />
      <h3>Close</h3>
      <AlertDialogTypes.Close />
      {/* @highlight-end */}
    </div>
  );
}
