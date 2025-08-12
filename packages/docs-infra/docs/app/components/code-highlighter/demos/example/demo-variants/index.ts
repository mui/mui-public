import { createDemoWithVariants } from '../../createDemo';
import RedButton from './RedButton';
import BlueButton from './BlueButton';

const VariantsExample = createDemoWithVariants(
  import.meta.url,
  {
    Red: RedButton,
    Blue: BlueButton,
  },
  {
    name: 'Button Variants',
    slug: 'button-variants',
  },
);

export default VariantsExample;
