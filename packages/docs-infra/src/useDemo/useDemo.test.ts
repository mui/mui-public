/**
 * @vitest-environment jsdom
 */
/**
 * Integration tests for useDemo functionality
 */
/* eslint-disable testing-library/no-node-access */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDemo } from './useDemo';
import type { ContentProps } from '../CodeHighlighter/types';

// Store the original createElement function before mocking
const originalCreateElement = document.createElement.bind(document);

// Create a proper DOM form element for mocking
const createMockForm = () => {
  const form = originalCreateElement('form');
  form.method = 'POST';
  form.target = '_blank';
  form.action = '';

  // Mock the submit method
  form.submit = vi.fn();

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
});

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
});
