import 'server-only';

import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';

import { DemoLiveContent as DemoContent } from './DemoLiveContent';

const projectPath = process.env.SOURCE_CODE_ROOT_PATH;
const projectUrl = process.env.SOURCE_CODE_ROOT_URL;

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param component The component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createLiveDemo = createDemoFactory({
  DemoContent,
  controlled: true,
  projectPath,
  projectUrl,
});

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * A variant is a different implementation style of the same component.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param variants The variants of the component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createLiveDemoWithVariants = createDemoWithVariantsFactory({
  DemoContent,
  controlled: true,
  projectPath,
  projectUrl,
});
