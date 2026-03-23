import 'server-only';

import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';

import { DemoPerformanceContent } from '@/components/DemoPerformanceContent';
import { DemoPerformanceContentLoading } from '@/components/DemoPerformanceContentLoading';

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * Also adds additional performance tracking capabilities.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param component The component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createDemoPerformance = createDemoFactory({
  DemoContent: DemoPerformanceContent,
  DemoContentLoading: DemoPerformanceContentLoading,
});

/**
 * Creates a demo component for displaying code examples with syntax highlighting.
 * A variant is a different implementation style of the same component.
 * Also adds additional performance tracking capabilities.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param variants The variants of the component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export const createDemoPerformanceWithVariants = createDemoWithVariantsFactory({
  DemoContent: DemoPerformanceContent,
  DemoContentLoading: DemoPerformanceContentLoading,
});
