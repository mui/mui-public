import { createDemo } from '@/functions/createDemo';
import Default from './HighlightProvider';

export const BaseHighlightProviderDemo = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Base Highlight Provider',
    slug: 'base',
    description: 'This shows a minimal use of the HighlightProvider component.',
    precompute: true,
  },
);
