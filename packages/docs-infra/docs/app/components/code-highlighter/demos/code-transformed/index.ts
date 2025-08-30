import { createDemo } from '../createDemo';
import Default from './TransformedCode';

export const CodeTransformations = createDemo(import.meta.url, Default, {
  name: 'Code Transformations',
  slug: 'code-transformations',
});
