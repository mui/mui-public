import { createDemo } from '../createDemo';
import Default from './FallbackDemo';

export const FallbackContent = createDemo(import.meta.url, Default, {
  name: 'Fallback Content',
  slug: 'fallback-content',
});
