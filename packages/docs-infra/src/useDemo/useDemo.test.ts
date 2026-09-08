/**
 * @vitest-environment jsdom
 */
/**
 * Integration tests for useDemo functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import LZString from 'lz-string';
import { useDemo } from './useDemo';
import type { Code, ContentProps } from '../CodeHighlighter/types';
import { CodeHighlighterContext } from '../CodeHighlighter/CodeHighlighterContext';

const copyToClipboard = vi.hoisted(() => vi.fn());

vi.mock('clipboard-copy', () => ({ default: copyToClipboard }));

// Store the original createElement function before mocking
const originalCreateElement = document.createElement.bind(document);
const createdForms: HTMLFormElement[] = [];

// Create a proper DOM form element for mocking
const createMockForm = () => {
  const form = originalCreateElement('form');
  form.method = 'POST';
  form.target = '_blank';
  form.action = '';

  // Mock the submit method
  form.submit = vi.fn();
  createdForms.push(form);

  return form;
};

// Mock document.createElement to return our proper DOM form
Object.defineProperty(document, 'createElement', {
  value: vi.fn((tagName: string) => {
    if (tagName === 'form') {
      return createMockForm();
    }
    return originalCreateElement(tagName);
  }),
  writable: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  createdForms.length = 0;
  const store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
    },
    configurable: true,
  });
});

function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    Array.from(form.querySelectorAll('input')).map((input) => [input.name, input.value]),
  );
}

function decodeCodeSandboxFiles(parameters: string): Record<string, { content: string }> {
  const base64 = parameters.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const decoded = LZString.decompressFromBase64(padded);
  if (!decoded) {
    throw new Error('Could not decode CodeSandbox parameters');
  }
  const payload: { files: Record<string, { content: string }> } = JSON.parse(decoded);
  return payload.files;
}

function decodeStackBlitzFiles(form: HTMLFormElement): Record<string, string> {
  const prefix = 'project[files][';
  const files: Record<string, string> = {};
  for (const [name, value] of Object.entries(formValues(form))) {
    if (name.startsWith(prefix) && name.endsWith(']')) {
      files[name.slice(prefix.length, -1)] = value;
    }
  }
  return files;
}

const entrypoint = `import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

const stackBlitzFiles = {
  'src/App.js': 'export const value = 1;',
  'src/helper.js': 'export const helper = true;',
  'src/styles.css': '.root { color: red; }',
  'src/index.jsx': entrypoint,
  'package.json': `{
  "private": true,
  "name": "source-policy-demo",
  "version": "0.0.0",
  "description": "Source Policy Demo demo",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest"
  }
}
`,
  'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { 'process.env': {} },
  ...{}
});
`,
  'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Source Policy Demo</title>
    <meta name="description" content="Source Policy Demo demo" />
    <meta name="viewport" content="initial-scale=1, width=device-width" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="src/index.jsx"></script>
  </body>
</html>
`,
};

const codeSandboxFiles = {
  'src/App.js': { content: 'export const value = 1;' },
  'src/helper.js': { content: 'export const helper = true;' },
  'src/styles.css': { content: '.root { color: red; }' },
  'src/index.jsx': { content: entrypoint },
  'package.json': {
    content: `{
  "private": true,
  "name": "source-policy-demo",
  "version": "0.0.0",
  "description": "Source Policy Demo demo",
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "dependencies": {
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "react-scripts": "latest"
  }
}
`,
  },
  'public/index.html': {
    content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Source Policy Demo</title>
    <meta name="description" content="Source Policy Demo demo" />
    <meta name="viewport" content="initial-scale=1, width=device-width" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
  },
};

describe('useDemo export configuration integration', () => {
  const mockContentProps: ContentProps<{}> = {
    name: 'Test Demo',
    code: {
      default: {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      },
    },
  };

  it('should apply common export config to both StackBlitz and CodeSandbox', () => {
    const htmlTemplate = vi.fn(({ title }) => `<html><head><title>${title}</title></head></html>`);

    const { result } = renderHook(() =>
      useDemo(mockContentProps, {
        export: {
          htmlTemplate,
          headTemplate: vi.fn(
            ({ variantName }) => `<meta name="variant" content="${variantName}" />`,
          ),
        },
      }),
    );

    // Trigger both exports through the hook
    result.current.openStackBlitz();
    result.current.openCodeSandbox();

    // Check that htmlTemplate was called for both exports
    expect(htmlTemplate).toHaveBeenCalledTimes(2);

    // Verify the HTML template was called with correct parameters
    expect(htmlTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test Demo',
        language: 'en',
        description: 'Test Demo demo',
        entrypoint: 'src/index.tsx', // No leading slash
        head: '<meta name="variant" content="default" />',
        variant: expect.objectContaining({
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
        }),
        variantName: 'default',
      }),
    );
  });

  it('should merge platform-specific config with common config', () => {
    const commonHtmlTemplate = vi.fn(
      ({ title }) => `<html><head><title>${title}</title></head></html>`,
    );
    const stackBlitzHtmlTemplate = vi.fn(
      ({ title }) => `<html><head><title>StackBlitz: ${title}</title></head></html>`,
    );

    const { result } = renderHook(() =>
      useDemo(mockContentProps, {
        export: {
          htmlTemplate: commonHtmlTemplate,
          dependencies: { 'common-lib': '1.0.0' },
        },
        exportStackBlitz: {
          htmlTemplate: stackBlitzHtmlTemplate,
          dependencies: { 'stackblitz-lib': '2.0.0' },
        },
        exportCodeSandbox: {
          dependencies: { 'codesandbox-lib': '3.0.0' },
          scripts: { 'sandbox-script': 'echo sandbox' },
        },
      }),
    );

    // Trigger StackBlitz export
    result.current.openStackBlitz();

    // Should use StackBlitz-specific template (overrides common)
    expect(stackBlitzHtmlTemplate).toHaveBeenCalledTimes(1);
    expect(commonHtmlTemplate).toHaveBeenCalledTimes(0);

    // Clear mocks and trigger CodeSandbox export
    vi.clearAllMocks();
    result.current.openCodeSandbox();

    // CodeSandbox should use common template (no override)
    expect(commonHtmlTemplate).toHaveBeenCalledTimes(1);
    expect(stackBlitzHtmlTemplate).toHaveBeenCalledTimes(0);
  });

  it('should support custom export functions', () => {
    const customExportFunction = vi.fn((variantCode, config) => ({
      exported: {
        ...variantCode,
        extraFiles: {
          ...variantCode.extraFiles,
          'custom-file.js': {
            source: `// Custom file added by custom export function\nconsole.log('Custom export: ${config.title}');`,
          },
        },
      },
      rootFile: '/custom-entry.js',
    }));

    const { result } = renderHook(() =>
      useDemo(mockContentProps, {
        export: {
          exportFunction: customExportFunction,
        },
      }),
    );

    // Trigger StackBlitz export
    result.current.openStackBlitz();

    // Verify custom export function was called with the correct variant code (single file)
    expect(customExportFunction).toHaveBeenCalledTimes(1);
    expect(customExportFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        url: 'file:///src/MyComponent.tsx',
      }),
      expect.objectContaining({
        title: 'Test Demo', // title comes from contentProps.name
        description: 'Test Demo demo',
        variantName: 'default',
        useTypescript: true,
        exportFunction: customExportFunction,
      }),
    );

    // Clear mocks and trigger CodeSandbox export
    vi.clearAllMocks();
    result.current.openCodeSandbox();

    // Should use the same custom export function for CodeSandbox too
    expect(customExportFunction).toHaveBeenCalledTimes(1);
  });

  it('should support platform-specific custom export functions', () => {
    const stackBlitzCustomExport = vi.fn((variantCode, _config) => ({
      exported: {
        ...variantCode,
        'stackblitz-custom.js': {
          url: 'file:///stackblitz-custom.js',
          fileName: 'stackblitz-custom.js',
          source: '// StackBlitz custom export',
        },
      },
      rootFile: '/stackblitz-entry.js',
    }));

    const codeSandboxCustomExport = vi.fn((variantCode, _config) => ({
      exported: {
        ...variantCode,
        'codesandbox-custom.js': {
          url: 'file:///codesandbox-custom.js',
          fileName: 'codesandbox-custom.js',
          source: '// CodeSandbox custom export',
        },
      },
      rootFile: '/codesandbox-entry.js',
    }));

    const { result } = renderHook(() =>
      useDemo(mockContentProps, {
        exportStackBlitz: {
          exportFunction: stackBlitzCustomExport,
        },
        exportCodeSandbox: {
          exportFunction: codeSandboxCustomExport,
        },
      }),
    );

    // Trigger StackBlitz export
    result.current.openStackBlitz();
    expect(stackBlitzCustomExport).toHaveBeenCalledTimes(1);
    expect(codeSandboxCustomExport).toHaveBeenCalledTimes(0);

    // Clear mocks and trigger CodeSandbox export
    vi.clearAllMocks();
    result.current.openCodeSandbox();
    expect(stackBlitzCustomExport).toHaveBeenCalledTimes(0);
    expect(codeSandboxCustomExport).toHaveBeenCalledTimes(1);
  });

  it('should support transformVariant in export configuration', () => {
    const transformVariant = vi.fn((variant, variantName) => ({
      ...variant,
      source: `// Transformed for ${variantName}\n${variant.source}`,
    }));

    const { result } = renderHook(() =>
      useDemo(mockContentProps, {
        export: {
          transformVariant,
        },
      }),
    );

    // Trigger StackBlitz export
    result.current.openStackBlitz();

    // Verify transformVariant was called
    expect(transformVariant).toHaveBeenCalledTimes(1);
    expect(transformVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        url: 'file:///src/MyComponent.tsx',
        extraFiles: {},
      }),
      'default', // variantName should be 'default'
      {}, // config object
    );

    // Clear mocks and trigger CodeSandbox export
    vi.clearAllMocks();
    result.current.openCodeSandbox();

    // Should call transformVariant for CodeSandbox too
    expect(transformVariant).toHaveBeenCalledTimes(1);
  });

  it('should support platform-specific transformVariant functions', () => {
    const stackBlitzTransform = vi.fn((variant, variantName) => ({
      ...variant,
      source: `// StackBlitz transform for ${variantName}\n${variant.source}`,
    }));

    const codeSandboxTransform = vi.fn((variant, variantName) => ({
      ...variant,
      source: `// CodeSandbox transform for ${variantName}\n${variant.source}`,
    }));

    const { result } = renderHook(() =>
      useDemo(mockContentProps, {
        exportStackBlitz: {
          transformVariant: stackBlitzTransform,
        },
        exportCodeSandbox: {
          transformVariant: codeSandboxTransform,
        },
      }),
    );

    // Trigger StackBlitz export
    result.current.openStackBlitz();
    expect(stackBlitzTransform).toHaveBeenCalledTimes(1);
    expect(codeSandboxTransform).toHaveBeenCalledTimes(0);

    // Clear mocks and trigger CodeSandbox export
    vi.clearAllMocks();
    result.current.openCodeSandbox();
    expect(stackBlitzTransform).toHaveBeenCalledTimes(0);
    expect(codeSandboxTransform).toHaveBeenCalledTimes(1);
  });

  it('uses current edited source for actions by default', async () => {
    const initialContentProps: ContentProps<{}> = {
      name: 'Source Policy Demo',
      code: {
        Default: {
          fileName: 'App.tsx',
          source: 'export const value: number = 1;',
          transforms: {
            js: {
              delta: { 0: ['export const value: number = 1;', 'export const value = 1;'] },
              fileName: 'App.js',
            },
          },
          extraFiles: {
            'helper.ts': {
              source: 'export const helper: boolean = true;',
              transforms: {
                js: {
                  delta: {
                    0: ['export const helper: boolean = true;', 'export const helper = true;'],
                  },
                  fileName: 'helper.js',
                },
              },
            },
          },
        },
      },
    };
    const editedCode: Code = {
      Default: {
        fileName: 'App.tsx',
        source: 'export const value: number = 2;',
        extraFiles: {
          'helper.ts': 'export const helper: boolean = false;',
        },
      },
    };

    function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        CodeHighlighterContext.Provider,
        { value: { code: editedCode, availableTransforms: ['js'] } },
        children,
      );
    }

    const { result } = renderHook(() => useDemo(initialContentProps, { selectedTransform: 'js' }), {
      wrapper: Wrapper,
    });

    act(() => result.current.selectFileName('helper.ts'));
    await act(() => result.current.copy({} as React.MouseEvent<Element>));
    await act(() => result.current.copyMarkdown({} as React.MouseEvent<Element>));

    expect(copyToClipboard.mock.calls.map(([contents]) => contents)).toEqual([
      'export const helper: boolean = false;',
      `### Source Policy Demo

\`\`\`tsx
// App.tsx

export const value: number = 2;
\`\`\`

\`\`\`ts
// helper.ts

export const helper: boolean = false;
\`\`\`
`,
    ]);

    result.current.openStackBlitz();
    result.current.openCodeSandbox();
    await waitFor(() => expect(createdForms).toHaveLength(2));

    const currentStackBlitzFiles = decodeStackBlitzFiles(createdForms[0]);
    expect(currentStackBlitzFiles['src/App.tsx']).toBe('export const value: number = 2;');
    expect(currentStackBlitzFiles['src/helper.ts']).toBe('export const helper: boolean = false;');
    expect(currentStackBlitzFiles).toHaveProperty('src/index.tsx');
    expect(currentStackBlitzFiles).toHaveProperty('tsconfig.json');
    expect(currentStackBlitzFiles).not.toHaveProperty('src/App.js');

    const currentCodeSandboxFiles = decodeCodeSandboxFiles(formValues(createdForms[1]).parameters);
    expect(currentCodeSandboxFiles['src/App.tsx'].content).toBe('export const value: number = 2;');
    expect(currentCodeSandboxFiles['src/helper.ts'].content).toBe(
      'export const helper: boolean = false;',
    );
    expect(currentCodeSandboxFiles).toHaveProperty('src/index.tsx');
    expect(currentCodeSandboxFiles).toHaveProperty('tsconfig.json');
    expect(currentCodeSandboxFiles).not.toHaveProperty('src/App.js');
  });

  it('copies and exports the selected original variant with its controlled transform', async () => {
    const initialContentProps: ContentProps<{}> = {
      name: 'Source Policy Demo',
      code: {
        Default: {
          fileName: 'App.tsx',
          source: 'export const defaultValue: number = 0;',
        },
        Alternate: {
          fileName: 'App.tsx',
          source: 'export const value: number = 1;',
          transforms: {
            js: {
              delta: { 0: ['export const value: number = 1;', 'export const value = 1;'] },
              fileName: 'App.js',
            },
            ts: { fileName: 'App.tsx', hasDelta: false },
          },
          extraFiles: {
            'helper.ts': {
              source: 'export const helper: boolean = true;',
              transforms: {
                js: {
                  delta: {
                    0: ['export const helper: boolean = true;', 'export const helper = true;'],
                  },
                  fileName: 'helper.js',
                },
                ts: { fileName: 'helper.ts', hasDelta: false },
              },
            },
            'styles.css': '.root { color: red; }',
          },
        },
      },
    };
    const editedCode: Code = {
      Default: {
        fileName: 'App.tsx',
        source: 'export const defaultValue: number = 20;',
      },
      Alternate: {
        fileName: 'App.tsx',
        source: 'export const value: number = 2;',
        extraFiles: {
          'helper.ts': 'export const helper: boolean = false;',
          'styles.css': '.root { color: blue; }',
        },
      },
    };

    function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        CodeHighlighterContext.Provider,
        { value: { code: editedCode, availableTransforms: ['js', 'ts'] } },
        children,
      );
    }

    window.localStorage.setItem('_docs_transform_pref:js:ts', 'ts');
    const { result } = renderHook(
      () =>
        useDemo(initialContentProps, {
          actionSource: 'initial',
          initialVariant: 'Alternate',
          selectedTransform: 'js',
        }),
      { wrapper: Wrapper },
    );

    expect(result.current.selectedVariant).toBe('Alternate');
    expect(result.current.selectedTransform).toBe('js');

    act(() => result.current.selectFileName('helper.ts'));
    await act(() => result.current.copy({} as React.MouseEvent<Element>));
    await act(() => result.current.copyMarkdown({} as React.MouseEvent<Element>));

    expect(copyToClipboard.mock.calls.map(([contents]) => contents)).toEqual([
      'export const helper = true;',
      `### Source Policy Demo

\`\`\`js
// App.js

export const value = 1;
\`\`\`

\`\`\`js
// helper.js

export const helper = true;
\`\`\`

\`\`\`css
/* styles.css */

.root { color: red; }
\`\`\`
`,
    ]);

    result.current.openStackBlitz();
    result.current.openCodeSandbox();

    await waitFor(() => expect(createdForms).toHaveLength(2));

    expect(decodeStackBlitzFiles(createdForms[0])).toEqual(stackBlitzFiles);
    expect(formValues(createdForms[0])).toMatchObject({
      'project[template]': 'node',
      'project[title]': 'Source Policy Demo',
      'project[description]': '# Source Policy Demo\nSource Policy Demo demo',
    });
    const codeSandboxValues = formValues(createdForms[1]);
    expect(decodeCodeSandboxFiles(codeSandboxValues.parameters)).toEqual(codeSandboxFiles);
    expect(codeSandboxValues.query).toBe('file=src/App.js');
  });
});
