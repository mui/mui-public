import { createDemo } from '../createDemo';
import Default from './PagesRouterDemo';

const DemoPagesRouterDemo = createDemo(import.meta.url, Default, {
  name: 'Next.js Pages Router',
  slug: 'demo-pages-router',
});

export default DemoPagesRouterDemo;
