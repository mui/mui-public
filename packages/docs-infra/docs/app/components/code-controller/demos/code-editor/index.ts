import { createDemo } from '@/functions/createDemo';
import { CodeEditor } from './CodeEditor';

export const DemoCodeControllerCodeEditor = createDemo(import.meta.url, CodeEditor, {
  name: 'Live Code Editor',
  slug: 'live-code-editor',
});
