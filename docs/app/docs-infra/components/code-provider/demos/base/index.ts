import { createDemo } from '@/functions/createDemo';
import { BasicCode } from './BasicCode';

export const DemoCodeProviderBase = createDemo(import.meta.url, BasicCode, {
  name: 'Base Code Provider',
  slug: 'base',
});
