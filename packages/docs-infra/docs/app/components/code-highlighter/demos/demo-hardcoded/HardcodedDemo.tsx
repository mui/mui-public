'use client';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSourceFactory } from '@mui/internal-docs-infra/parseSource';
import { TsToJsTransformer } from '@mui/internal-docs-infra/transformTsToJs';
import { DemoContent } from '../DemoContent';

// Counter component for the demo
function Counter() {
  const [count, setCount] = React.useState(0);

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 16px 0', color: '#333' }}>Counter: {count}</h2>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
        <button
          onClick={() => setCount(count - 1)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          -
        </button>
        <button
          onClick={() => setCount(0)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#757575',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
        <button
          onClick={() => setCount(count + 1)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#4caf50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function HardcodedDemo() {
  // Precomputed code variants - this would normally be generated at build time
  const precomputedCode = {
    Default: {
      url: 'file://counter.tsx',
      fileName: 'Counter.tsx',
      source: `import * as React from 'react';

function Counter() {
  const [count, setCount] = React.useState(0);
  
  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 16px 0', color: '#333' }}>
        Counter: {count}
      </h2>
      <div style={{ 
        display: 'flex', 
        gap: '8px', 
        justifyContent: 'center' 
      }}>
        <button 
          onClick={() => setCount(count - 1)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          -
        </button>
        <button 
          onClick={() => setCount(0)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#757575',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
        <button 
          onClick={() => setCount(count + 1)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#4caf50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default Counter;`,
      // For optimal performance, you could also precompute transforms here
      transforms: {
        js: {
          delta: {}, // This would contain the actual transformation delta
          fileName: 'Counter.js',
        },
      },
    },
  };

  return (
    <div>
      <div
        style={{
          padding: '16px',
          marginBottom: '16px',
          backgroundColor: '#e8f5e8',
          borderRadius: '4px',
          border: '1px solid #4caf50',
        }}
      >
        <h4 style={{ margin: '0 0 8px 0', color: '#2e7d32' }}>⚡ Performance Optimized</h4>
        <p style={{ margin: '0', fontSize: '14px', color: '#2e7d32' }}>
          This demo uses precomputed/hardcoded code content, which enables:
        </p>
        <ul style={{ margin: '8px 0 0 16px', fontSize: '14px', color: '#2e7d32' }}>
          <li>Server-side rendering</li>
          <li>Faster initial load times</li>
          <li>No runtime code parsing</li>
          <li>Pre-transformed variants</li>
        </ul>
      </div>

      <CodeHighlighter
        url="file://counter.tsx"
        code={precomputedCode}
        components={{ Default: <Counter /> }}
        Content={DemoContent}
        precompute={precomputedCode}
        sourceParser={parseSourceFactory()}
        sourceTransformers={[TsToJsTransformer]}
        name="Counter Component"
        description="Interactive counter with increment, decrement, and reset functionality"
      />
    </div>
  );
}
