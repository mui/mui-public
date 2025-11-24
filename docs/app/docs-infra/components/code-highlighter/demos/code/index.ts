import { createDemo } from '@/functions/createDemo';
import { BasicCode } from './BasicCode';

export const DemoCodeHighlighterCode = createDemo(import.meta.url, BasicCode, {
  name: 'Simple Code Block',
  slug: 'simple-code-block',
});
