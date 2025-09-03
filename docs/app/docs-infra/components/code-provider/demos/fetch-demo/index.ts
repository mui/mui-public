import { createDemo } from '@/functions/createDemo';
import { Docs } from './Docs';

export const DemoCodeProviderFetchDemo = createDemo(import.meta.url, Docs, {
  name: 'Fetch Demo Code Provider',
  slug: 'fetch',
});
