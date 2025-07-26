import { createDemo } from '@/functions/createDemo';
import { LiveDemo } from './LiveDemo';

export const DemoCodeControllerLiveDemo = createDemo(import.meta.url, LiveDemo, {
  name: 'Live Demo',
  slug: 'live-demo',
});
