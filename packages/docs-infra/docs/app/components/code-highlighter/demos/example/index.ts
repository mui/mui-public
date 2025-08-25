import { createDemoWithVariants } from '../createDemo';
import BasicExampleWrapper from './BasicExampleWrapper';
import VariantsExampleWrapper from './VariantsExampleWrapper';

export const CreateDemoExamples = createDemoWithVariants(
  import.meta.url,
  {
    Basic: BasicExampleWrapper,
    Variants: VariantsExampleWrapper,
  },
  {
    name: 'createDemo Examples',
    slug: 'create-demo-examples',
  },
);
