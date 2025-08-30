import { createDemo } from '../createDemo';
import Default from './IdleHighlightCode';

export const LazyHighlighting = createDemo(import.meta.url, Default, {
  name: 'Lazy Highlighting',
  slug: 'lazy-highlighting',
});
