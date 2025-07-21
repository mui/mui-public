import { createDemo } from '../createDemo';
import Default from './BasicCode';

export const SimpleCodeBlock = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Simple Code Block',
    slug: 'simple-code-block',
    precompute: true,
  },
);
