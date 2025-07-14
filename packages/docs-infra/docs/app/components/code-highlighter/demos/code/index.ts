import { createDemo } from '@/functions/createDemo';
import Default from './BasicCode';

export const CodeDemo = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Basic Code Block',
    slug: 'code',
    precompute: true,
  },
);
