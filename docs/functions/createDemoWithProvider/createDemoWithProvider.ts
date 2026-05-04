import 'server-only';

import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';

import { CollapsibleDemoContent as DemoContent } from '../../app/docs-infra/pipeline/enhance-code-emphasis/demos/CollapsibleDemoContent';
import { DemoTitle } from '../../app/docs-infra/components/code-highlighter/demos/DemoTitle';
import { DemoDataCodeProvider } from '../../demo-data/code-provider';

const demoGlobalData = [DemoDataCodeProvider];

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param component The component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createDemoWithProvider = createDemoFactory({
  DemoContent,
  DemoTitle,
  demoGlobalData,
});

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * A variant is a different implementation style of the same component.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param variants The variants of the component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createDemoWithProviderWithVariants = createDemoWithVariantsFactory({
  DemoContent,
  DemoTitle,
  demoGlobalData,
});
