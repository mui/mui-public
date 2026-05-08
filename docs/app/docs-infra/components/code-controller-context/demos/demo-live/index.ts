import { createDemoWithProvider } from '@/functions/createDemoWithProvider';
import { DemoLive } from './DemoLive';

export const DemoCodeControllerDemoLive = createDemoWithProvider(import.meta.url, DemoLive, {
  name: 'Live Demo',
  slug: 'live-demo',
});
