import { createDemoWithProvider } from '@/functions/createDemoWithProvider';
import { EditableToggle } from './EditableToggle';

export const DemoCodeControllerEditableToggle = createDemoWithProvider(
  import.meta.url,
  EditableToggle,
  {
    name: 'Editable Toggle',
    slug: 'editable-toggle',
  },
);
