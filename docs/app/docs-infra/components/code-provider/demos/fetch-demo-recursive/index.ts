import { createDemo } from '@/functions/createDemo';
import { Docs } from './Docs';

export const DemoCodeProviderFetchDemoRecursive = createDemo(import.meta.url, Docs, {
  name: 'Recursive Fetch Demo Code Provider',
  slug: 'fetch-recursive',
});
