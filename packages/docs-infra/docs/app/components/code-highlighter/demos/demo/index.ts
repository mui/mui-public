import { createDemo } from '@/functions/createDemo';
import { CheckboxDemo } from './demo-basic';

export const InteractiveDemo = createDemo(
  import.meta.url,
  { Default: CheckboxDemo },
  {
    name: 'Interactive Demo',
    slug: 'interactive-demo',
    precompute: true,
  },
);
