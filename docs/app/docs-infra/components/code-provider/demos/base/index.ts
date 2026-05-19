import { createDemoWithProvider } from '@/functions/createDemoWithProvider';
import { BasicCode } from './BasicCode';

export const DemoCodeProviderBase = createDemoWithProvider(import.meta.url, BasicCode, {
  name: 'Base Code Provider',
  slug: 'base',
});
