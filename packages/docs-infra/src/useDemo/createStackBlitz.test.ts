/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { createStackBlitz } from './createStackBlitz';
import type { FlattenedFiles } from '../pipeline/loadCodeVariant/flattenCodeVariant';

describe('createStackBlitz', () => {
  it('should create correct StackBlitz configuration', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'package.json': { source: '{"name": "test", "dependencies": {"react": "^18.0.0"}}' },
    };

    const output = createStackBlitz({
      title: 'Test Demo',
      description: 'A test demo',
      flattenedFiles,
      rootFile: 'src/Demo.jsx',
    });

    expect(output.url).toBe('https://stackblitz.com/run?file=src/Demo.jsx');
    expect(output.formData['project[template]']).toBe('node');
    expect(output.formData['project[title]']).toBe('Test Demo');
    expect(output.formData['project[description]']).toBe('# Test Demo\nA test demo');
    expect(output.formData['project[files][src/Demo.jsx]']).toBe(
      'export default function Demo() { return <div>Hello</div>; }',
    );
    expect(output.formData['project[files][package.json]']).toBe(
      '{"name": "test", "dependencies": {"react": "^18.0.0"}}',
    );
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

    const output = createStackBlitz({
      title: 'TypeScript Demo',
      description: 'A TypeScript demo',
      flattenedFiles,
      rootFile: 'src/Demo.tsx',
    });

    expect(output.url).toBe('https://stackblitz.com/run?file=src/Demo.tsx');
    expect(output.formData['project[template]']).toBe('node');
    expect(output.formData['project[title]']).toBe('TypeScript Demo');
    expect(output.formData['project[description]']).toBe('# TypeScript Demo\nA TypeScript demo');
    expect(output.formData['project[files][src/Demo.tsx]']).toBe(
      'export default function Demo(): React.FC { return <div>Hello</div>; }',
    );
  });

  it('should use custom entrypoint', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/MyComponent.jsx': {
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      },
      'src/other.jsx': { source: 'export default function Other() { return <div>Other</div>; }' },
    };

    const output = createStackBlitz({
      title: 'Custom Main File',
      description: 'Demo with custom main file',
      flattenedFiles,
      rootFile: 'src/MyComponent.jsx',
    });

    expect(output.url).toBe('https://stackblitz.com/run?file=src/MyComponent.jsx');
  });

  it('should use different entrypoint when specified', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'src/App.jsx': { source: 'export default function App() { return <div>App</div>; }' },
    };

    const output = createStackBlitz({
      title: 'Custom Initial File',
      description: 'Demo with custom initial file',
      flattenedFiles,
      rootFile: 'src/App.jsx',
    });

    expect(output.url).toBe('https://stackblitz.com/run?file=src/App.jsx');
  });

  it('should handle different file paths as entrypoint', () => {
    const flattenedFiles: FlattenedFiles = {
      'components/Button.jsx': {
        source: 'export default function Button() { return <button>Click</button>; }',
      },
    };

    const output = createStackBlitz({
      title: 'Fallback Demo',
      description: 'A demo with fallback',
      flattenedFiles,
      rootFile: 'components/Button.jsx',
    });

    expect(output.url).toBe('https://stackblitz.com/run?file=components/Button.jsx');
  });

  it('should handle files with different extensions', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.tsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'src/utils.js': { source: 'export const helper = () => {};' },
      'package.json': { source: '{"name": "test"}' },
    };

    const output = createStackBlitz({
      title: 'Mixed Extensions',
      description: 'Demo with mixed file extensions',
      flattenedFiles,
      rootFile: 'src/Demo.tsx',
    });

    expect(output.url).toBe('https://stackblitz.com/run?file=src/Demo.tsx');
  });

  it('should convert flattened files to StackBlitz format', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'package.json': { source: '{"name": "test", "dependencies": {"react": "^18.0.0"}}' },
      'README.md': { source: '# Test Demo\nThis is a test.' },
      'src/utils.js': { source: 'export const helper = () => {};' },
    };

    const output = createStackBlitz({
      title: 'File Conversion Test',
      description: 'Testing file conversion',
      flattenedFiles,
      rootFile: 'src/Demo.jsx',
    });

    expect(output.formData['project[files][src/Demo.jsx]']).toBe(
      'export default function Demo() { return <div>Hello</div>; }',
    );
    expect(output.formData['project[files][package.json]']).toBe(
      '{"name": "test", "dependencies": {"react": "^18.0.0"}}',
    );
    expect(output.formData['project[files][README.md]']).toBe('# Test Demo\nThis is a test.');
    expect(output.formData['project[files][src/utils.js]']).toBe('export const helper = () => {};');
  });

  it('should handle complex file structures', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'src/components/Button.jsx': {
        source: 'export default function Button() { return <button>Click</button>; }',
      },
      'src/utils/helpers.js': { source: 'export const helper = () => {};' },
      'package.json': { source: '{"name": "complex-demo", "dependencies": {"react": "^18.0.0"}}' },
      'public/index.html': {
        source: '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
      },
    };

    const output = createStackBlitz({
      title: 'Complex Demo',
      description: 'A complex demo with nested structure',
      flattenedFiles,
      rootFile: 'src/Demo.jsx',
    });

    expect(output.url).toBe('https://stackblitz.com/run?file=src/Demo.jsx');
    expect(output.formData['project[files][src/components/Button.jsx]']).toBe(
      'export default function Button() { return <button>Click</button>; }',
    );
    expect(output.formData['project[files][src/utils/helpers.js]']).toBe(
      'export const helper = () => {};',
    );
    expect(output.formData['project[files][public/index.html]']).toBe(
      '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    );
  });

  it('should skip files with undefined source', () => {
    const flattenedFiles: FlattenedFiles = {
      'src/Demo.jsx': { source: 'export default function Demo() { return <div>Hello</div>; }' },
      'src/empty.jsx': { source: undefined as any }, // This should be skipped
      'package.json': { source: '{"name": "test"}' },
    };

    const output = createStackBlitz({
      title: 'Skip Empty Files',
      description: 'Demo that skips empty files',
      flattenedFiles,
      rootFile: 'src/Demo.jsx',
    });

    expect(output.formData['project[files][src/Demo.jsx]']).toBe(
      'export default function Demo() { return <div>Hello</div>; }',
    );
    expect(output.formData['project[files][package.json]']).toBe('{"name": "test"}');
    expect(output.formData['project[files][src/empty.jsx]']).toBeUndefined();
  });
});
