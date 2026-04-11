import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';

export default function CheckboxBasic() {
  return (
    <div>
      {/* @highlight-start @focus */}
      <Checkbox defaultChecked />
      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>
      {/* @highlight-end */}
    </div>
  );
}
