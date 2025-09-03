import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';
import { loadServerCodeMeta } from '@mui/internal-docs-infra/pipeline/loadServerCodeMeta';
import { loadServerSource } from '@mui/internal-docs-infra/pipeline/loadServerSource';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';

import { DemoContent } from '../DemoContent';

const sourceParser = createParseSource();

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param component The component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createDemo = createDemoFactory({
  DemoContent,
  loadCodeMeta: loadServerCodeMeta,
  loadSource: loadServerSource,
  sourceParser,
});

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * A variant is a different implementation style of the same component.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param variants The variants of the component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createDemoWithVariants = createDemoWithVariantsFactory({
  DemoContent,
  loadCodeMeta: loadServerCodeMeta,
  loadSource: loadServerSource,
  sourceParser,
});
