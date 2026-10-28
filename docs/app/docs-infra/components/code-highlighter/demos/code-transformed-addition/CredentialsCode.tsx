import * as React from 'react';
import { Code } from './Code';

export function CredentialsCode() {
  return (
    // @focus
    <Code fileName="example.tsx">{`import { ApiClient } from './client';\n\nexport function App() {\n  return <ApiClient apiKey={API_KEY} />;\n}`}</Code>
  );
}
