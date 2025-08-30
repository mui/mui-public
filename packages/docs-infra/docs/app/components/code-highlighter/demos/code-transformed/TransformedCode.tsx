'use client';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { TypescriptToJavascriptTransformer } from '@mui/internal-docs-infra/pipeline/transformTypescriptToJavascript';
import { DemoContent } from '../DemoContent';

// Sample TypeScript component with interfaces and generics
function GenericForm<T extends Record<string, unknown>>() {
  const [data, setData] = React.useState<T>({} as T);

  return (
    <div style={{ padding: '16px' }}>
      <h3>Generic Form Component</h3>
      <form>
        <div style={{ marginBottom: '12px' }}>
          <label htmlFor="name">Name:</label>
          <input
            id="name"
            type="text"
            value={((data as Record<string, unknown>).name as string) || ''}
            onChange={(event) => setData((prev) => ({ ...prev, name: event.target.value }))}
            style={{ marginLeft: '8px', padding: '4px' }}
          />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label htmlFor="email">Email:</label>
          <input
            id="email"
            type="email"
            value={((data as Record<string, unknown>).email as string) || ''}
            onChange={(event) => setData((prev) => ({ ...prev, email: event.target.value }))}
            style={{ marginLeft: '8px', padding: '4px' }}
          />
        </div>
        <button type="button" style={{ padding: '6px 12px' }}>
          Submit
        </button>
      </form>
    </div>
  );
}

export default function TransformedCode() {
  const typeScriptCode = `import * as React from 'react';

interface FormData {
  name: string;
  email: string;
  age?: number;
}

interface GenericFormProps<T extends Record<string, unknown>> {
  initialData?: T;
  onSubmit?: (data: T) => void;
  validation?: (data: T) => string | null;
}

function GenericForm<T extends Record<string, unknown>>({ 
  initialData, 
  onSubmit,
  validation 
}: GenericFormProps<T>) {
  const [data, setData] = React.useState<T>(initialData || {} as T);
  const [error, setError] = React.useState<string | null>(null);
  
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    
    if (validation) {
      const validationError = validation(data);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    
    setError(null);
    onSubmit?.(data);
  };

  const updateField = (field: keyof T, value: unknown) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ color: 'red', marginBottom: '12px' }}>
          {error}
        </div>
      )}
      
      <div style={{ marginBottom: '12px' }}>
        <label htmlFor="name">Name:</label>
        <input 
          id="name"
          type="text" 
          value={(data as Record<string, unknown>).name as string || ''} 
          onChange={(event) => updateField('name' as keyof T, event.target.value)}
          required
        />
      </div>
      
      <div style={{ marginBottom: '12px' }}>
        <label htmlFor="email">Email:</label>
        <input 
          id="email"
          type="email" 
          value={(data as Record<string, unknown>).email as string || ''} 
          onChange={(event) => updateField('email' as keyof T, event.target.value)}
          required
        />
      </div>
      
      <button type="submit">
        Submit Form
      </button>
    </form>
  );
}

export default GenericForm;`;

  return (
    <div>
      <div
        style={{
          padding: '16px',
          marginBottom: '16px',
          backgroundColor: '#f3e5f5',
          borderRadius: '4px',
          border: '1px solid #9c27b0',
        }}
      >
        <h4 style={{ margin: '0 0 8px 0', color: '#7b1fa2' }}>🔄 Automatic Code Transformation</h4>
        <p style={{ margin: '0', fontSize: '14px', color: '#7b1fa2' }}>
          This demo shows a TypeScript component that gets automatically transformed to JavaScript.
          Switch between the TypeScript and JavaScript tabs to see the transformation in action. The
          TypeScript version includes interfaces, generics, and type annotations that are stripped
          out in the JavaScript version.
        </p>
      </div>

      <CodeHighlighter
        url="file://generic-form.tsx"
        code={{
          Default: {
            url: 'file://generic-form.tsx',
            fileName: 'GenericForm.tsx',
            source: typeScriptCode,
          },
        }}
        components={{ Default: <GenericForm /> }}
        Content={DemoContent}
        sourceParser={createParseSource()}
        sourceTransformers={[TypescriptToJavascriptTransformer]}
        name="Generic Form Component"
      />
    </div>
  );
}
