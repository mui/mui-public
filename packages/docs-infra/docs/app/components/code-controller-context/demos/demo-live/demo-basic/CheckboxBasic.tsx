import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';

export default function CheckboxBasic() {
  return (
    <div>
      <Checkbox defaultChecked />
      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>
    </div>
  );
}
