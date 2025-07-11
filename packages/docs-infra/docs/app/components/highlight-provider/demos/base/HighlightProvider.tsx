import { HighlightProvider } from '../../../../../../build/esm/CodeProvider';
import Code from '../../../code-highlighter/demos/Code';

export default function HighlightProvider() {
  return (
    <HighlightProvider>
      <Code forceClient>{`console.log('Hello, world!');`}</Code>
    </HighlightProvider>
  );
}
