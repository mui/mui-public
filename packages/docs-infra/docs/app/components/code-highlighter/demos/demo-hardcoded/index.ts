import { createDemo } from '../createDemo';
import Default from './HardcodedDemo';

export const PrecomputedContent = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Precomputed Content',
    slug: 'precomputed-content',
  },
);
