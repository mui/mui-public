import { createDemo } from './createDemo';
import { Counter } from './Counter';

export const DemoCollapsibleDemo = createDemo(import.meta.url, Counter, {
  name: 'Collapsible Demo',
  slug: 'collapsible-demo',
});
