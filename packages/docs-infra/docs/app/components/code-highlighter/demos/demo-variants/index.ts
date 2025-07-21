import { createDemo } from '../createDemo';
import ButtonDemo from './ButtonDemo';
import CheckboxDemo from './CheckboxDemo';
import InputDemo from './InputDemo';

export const MultipleVariants = createDemo(
  import.meta.url,
  {
    Button: ButtonDemo,
    Checkbox: CheckboxDemo,
    Input: InputDemo,
  },
  {
    name: 'Multiple Variants',
    slug: 'multiple-variants',
    precompute: true,
  },
);
