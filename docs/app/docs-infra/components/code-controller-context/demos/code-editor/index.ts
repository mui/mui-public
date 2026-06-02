import { createDemoWithProvider } from '@/functions/createDemoWithProvider';
import { CodeEditor } from './CodeEditor';

export const DemoCodeControllerCodeEditor = createDemoWithProvider(import.meta.url, CodeEditor, {
  name: 'Live Code Editor',
  slug: 'live-code-editor',
});
