import { createDemo } from '../createDemo';
import Default from './PagesRouterDemo';

const DemoPagesRouterDemo = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Next.js Pages Router',
    slug: 'demo-pages-router',
    description: 'Integration example for Next.js Pages Router applications.',
  },
);

export default DemoPagesRouterDemo;
