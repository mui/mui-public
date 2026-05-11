import { createDemo } from '@/functions/createDemo';
import { DemoCounter } from './demo-counter';

export const DemoCollapsibleDemo = createDemo(import.meta.url, DemoCounter, {
  name: 'Collapsible Demo',
  slug: 'collapsible-demo',
});
