import { createDemo } from '../../../../../functions/createDemo';
import { MultiFileEditor } from './MultiFileEditor';

export const DemoCodeControllerMultiFile = createDemo(import.meta.url, MultiFileEditor, {
  name: 'Multi-File Editor',
  slug: 'multi-file-editor',
});
