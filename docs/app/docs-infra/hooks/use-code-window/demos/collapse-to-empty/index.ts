import { createDemo } from '@/functions/createDemo';
import { CollapseToEmptyCode } from './CollapseToEmptyCode';

export const DemoCollapseToEmpty = createDemo(import.meta.url, CollapseToEmptyCode, {
  name: 'Collapse to Empty',
  slug: 'collapse-to-empty',
});
