import { BasicCheckbox } from './BasicCheckbox';
import { createDemo } from '../../createDemo';

export const CheckboxDemo = createDemo(
  import.meta.url,
  {
    Default: BasicCheckbox,
  },
  {
    name: 'Checkbox',
    slug: 'basic',
    description: 'This shows a basic checkbox component.',
    precompute: true,
  },
);
