import { createDemoWithProvider } from '@/functions/createDemoWithProvider';
import { MultiFileEditor } from './MultiFileEditor';

export const DemoCodeControllerMultiFile = createDemoWithProvider(
  import.meta.url,
  MultiFileEditor,
  {
    name: 'Multi-File Editor',
    slug: 'multi-file-editor',
  },
);
