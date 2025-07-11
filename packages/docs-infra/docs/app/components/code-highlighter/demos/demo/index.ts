import createDemo from '../createDemo';
import { default as Default } from './default';

const DemoDemo = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Demo',
    slug: 'demo',
    description: 'This is a demo component for CodeHighlighter.',
    // pathPrefix: 'demos/basic', TODO: filename shown is prefixed with this
    precompute: true,
  },
);

export default DemoDemo;
