import { createDemo } from '@/functions/createDemo';
import { BasicCheckbox } from './BasicCheckbox';

const CheckboxDemo = createDemo(
  import.meta.url,
  {
    Default: BasicCheckbox,
  },
  {
    name: 'Checkbox',
    slug: 'basic',
    description: 'This shows a basic checkbox component.',
    code: {
      Default: {
        fileName: 'BasicCheckbox.js',
        source: `import * as React from 'react';
import { Checkbox } from '../../../_stubs/checkbox';

export function BasicCheckbox() {
  return <Checkbox defaultChecked />;
}
`, // TODO: use precompute instead
      },
    },
  },
);

export default CheckboxDemo;
