import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import Code from '../../../code-highlighter/demos/Code';

export default function HighlightProvider() {
  return (
    <CodeProvider>
      <Code forceClient>{`console.log('Hello, world!');`}</Code>
    </CodeProvider>
  );
}
