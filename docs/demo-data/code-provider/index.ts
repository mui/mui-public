import { createDemoGlobal } from '@mui/internal-docs-infra/createDemoData';
import type { DemoGlobalData } from '@mui/internal-docs-infra/createDemoData/types';
import DemoCodeProvider from './DemoCodeProvider';

export const DemoDataCodeProvider: DemoGlobalData = createDemoGlobal(
  import.meta.url,
  DemoCodeProvider,
);
