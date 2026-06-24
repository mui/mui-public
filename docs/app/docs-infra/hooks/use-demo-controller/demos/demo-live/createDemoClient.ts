'use client';

import { createDemoClientFactory } from '@mui/internal-docs-infra/abstractCreateDemoClient';
import { DemoController } from './DemoController';

/**
 * Creates a demo client copying dependencies in the client bundle for live editing.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param meta Additional meta and modules for the demo client.
 */
export const createDemoClient = createDemoClientFactory({
  DemoController,
});
