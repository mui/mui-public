import createDemo from '../createDemo';
import Default from './ControlledCode';

export const ControlledCodeDemo = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Controlled Code Demo',
    slug: 'controlled',
    description: 'This shows a controlled code demo.',
    precompute: true,
  },
);
