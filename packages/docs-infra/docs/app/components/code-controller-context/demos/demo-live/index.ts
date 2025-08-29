import { createDemo } from '../../../../../functions/createDemo';
import { DemoLive } from './DemoLive';

export const DemoCodeControllerDemoLive = createDemo(import.meta.url, DemoLive, {
  name: 'Live Demo',
  slug: 'live-demo',
});
