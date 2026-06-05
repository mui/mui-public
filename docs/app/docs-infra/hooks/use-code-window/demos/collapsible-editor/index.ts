import { createDemo } from '@/functions/createDemo';
import { CollapsibleEditor } from './CollapsibleEditor';

export const DemoCollapsibleEditor = createDemo(import.meta.url, CollapsibleEditor, {
  name: 'Collapsible Editor',
  slug: 'collapsible-editor',
});
