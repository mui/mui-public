import { createDemo } from '../../createDemo';
import RedButton from './RedButton';
import BlueButton from './BlueButton';

const VariantsExample = createDemo(
  import.meta.url,
  {
    Red: RedButton,
    Blue: BlueButton,
  },
  {
    name: 'Button Variants',
    slug: 'button-variants',
    description: 'Two color variants of a button.',
    precompute: true,
  },
);

export default VariantsExample;
