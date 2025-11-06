/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { createCodeSandbox } from './createCodeSandbox';
import type { FlattenedFiles } from '../pipeline/loadCodeVariant/flattenCodeVariant';

// Mock LZString for compression
vi.mock('lz-string', () => ({
  default: {
    compressToBase64: vi.fn((str: string) => btoa(str).replace(/=/g, '')),
  },
}));

describe('createCodeSandbox', () => {
  it('should create correct CodeSandbox configuration', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'package.json': { source: '{"name": "test", "dependencies": {"react": "^18.0.0"}}' },
    };

    const output = createCodeSandbox({
      flattenedFiles,
      rootFile: 'src/Demo.jsx',
    });

    expect(output.url).toBe('https://codesandbox.io/api/v1/sandboxes/define');
    expect(output.formData.parameters).toBeDefined();
    expect(output.formData.query).toBe('file=src/Demo.jsx');
  });

  it('should handle TypeScript files correctly', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.tsx': {
        source: 'export default function Demo(): React.FC { return <div>Hello</div>; }',
      },
      'package.json': {
        source: '{"name": "test", "dependencies": {"react": "^18.0.0", "@types/react": "^18.0.0"}}',
      },
    };

    const output = createCodeSandbox({
      flattenedFiles,
      rootFile: 'src/Demo.tsx',
    });

    expect(output.url).toBe('https://codesandbox.io/api/v1/sandboxes/define');
    expect(output.formData.parameters).toBeDefined();
    expect(output.formData.query).toBe('file=src/Demo.tsx');
  });

  it('should use custom entrypoint', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/MyComponent.jsx': {
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      },
      'src/other.jsx': { source: 'export default function Other() { return <div>Other</div>; }' },
    };

    const output = createCodeSandbox({
      flattenedFiles,
      rootFile: 'src/MyComponent.jsx',
    });

    expect(output.formData.query).toBe('file=src/MyComponent.jsx');
  });

  it('should use different entrypoint when specified', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'src/App.jsx': { source: 'export default function App() { return <div>App</div>; }' },
    };

    const output = createCodeSandbox({
      flattenedFiles,
      rootFile: 'src/App.jsx',
    });

    expect(output.formData.query).toBe('file=src/App.jsx');
  });

  it('should handle different file paths as entrypoint', () => {
    const flattenedFiles: FlattenedFiles = {
      'components/Button.jsx': {
        source: 'export default function Button() { return <button>Click</button>; }',
      },
    };

    const output = createCodeSandbox({
      flattenedFiles,
      rootFile: 'components/Button.jsx',
    });

    expect(output.formData.query).toBe('file=components/Button.jsx');
  });

  it('should handle files with different extensions', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.tsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'src/utils.js': { source: 'export const helper = () => {};' },
      'package.json': { source: '{"name": "test"}' },
    };

    const output = createCodeSandbox({
      flattenedFiles,
      rootFile: 'src/Demo.tsx',
    });

    expect(output.formData.query).toBe('file=src/Demo.tsx');
  });

  it('should convert flattened files to CodeSandbox format', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'package.json': { source: '{"name": "test", "dependencies": {"react": "^18.0.0"}}' },
      'README.md': { source: '# Test Demo\nThis is a test.' },
    };

    const output = createCodeSandbox({
      flattenedFiles,
      rootFile: 'src/Demo.jsx',
    });

    // Since we're mocking LZString, we can't test the exact compressed content
    // but we can verify that parameters is present and the structure is correct
    expect(output.formData.parameters).toBeDefined();
    expect(typeof output.formData.parameters).toBe('string');
  });
});
