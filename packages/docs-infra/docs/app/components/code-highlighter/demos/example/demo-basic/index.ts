import { createDemo } from '../../createDemo';
import SimpleButton from './SimpleButton';

const BasicExample = createDemo(
  import.meta.url,
  { Default: SimpleButton },
  {
    name: 'Basic Button',
    slug: 'basic-button',
    description: 'A simple interactive button component.',
    precompute: true,
  },
);

export default BasicExample;
