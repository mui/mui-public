import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';

export function CheckboxRed() {
  return (
    // @highlight @focus
    <Checkbox defaultChecked className="bg-red-500" />
  );
}
