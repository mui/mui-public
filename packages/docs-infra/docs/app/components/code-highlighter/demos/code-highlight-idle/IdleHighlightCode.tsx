import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { TypescriptToJavascriptTransformer } from '@mui/internal-docs-infra/pipeline/transformTypescriptToJavascript';
import { CodeContent } from '../CodeContent';

const sampleCode = `// This code will be highlighted when the user is idle
// to improve initial page load performance

import React from 'react';
import { useState, useEffect } from 'react';

function DataFetcher({ url }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(\`HTTP error! status: \${response.status}\`);
        }
        
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (url) {
      fetchData();
    }
  }, [url]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div>
      <h2>Fetched Data</h2>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

export default DataFetcher;`;

export default function IdleHighlightCode() {
  return (
    <div>
      <div
        style={{
          padding: '16px',
          marginBottom: '16px',
          backgroundColor: '#f5f5f5',
          borderRadius: '4px',
          fontSize: '14px',
        }}
      >
        <strong>Performance Note:</strong> This code block uses <code>highlightAt="idle"</code>
        which means syntax highlighting will be applied when the browser is idle, improving initial
        page load performance for non-critical code blocks.
      </div>

      <CodeHighlighter
        url="file://data-fetcher.tsx"
        code={{
          Default: {
            url: 'file://data-fetcher.tsx',
            fileName: 'DataFetcher.tsx',
            source: sampleCode,
          },
        }}
        Content={CodeContent}
        highlightAt="idle"
        sourceParser={createParseSource()}
        sourceTransformers={[TypescriptToJavascriptTransformer]}
        name="Data Fetcher Component"
      />
    </div>
  );
}
