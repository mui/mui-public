import createDemo from '../../../code-highlighter/demos/createDemo';
import Default from './HighlightProvider';

export const FetchHighlightProviderDemo = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Fetch Highlight Provider',
    slug: 'fetch',
    description: "This shows a client-side fetch for a demo's code.",
    precompute: true,
  },
);
