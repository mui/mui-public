import { createDemo } from '../createDemo';
import Default from './ControlledCode';

export const ControlledCodeEditor = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Controlled Code Editor',
    slug: 'controlled-code-editor',
    precompute: true,
  },
);
