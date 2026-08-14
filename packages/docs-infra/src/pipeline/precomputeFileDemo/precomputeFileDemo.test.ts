import { describe, expect, it, vi } from 'vitest';
import type { LoadSource } from '../../CodeHighlighter/types';
import { decodeSourceToText } from '../loadIsomorphicCodeVariant/decodeSourceToText';
import { precomputeFileDemo } from './precomputeFileDemo';
import type { FileDemoDescriptor } from './types';

const MATERIAL_DEMO_URL = new URL('../precomputeDemo/fixtures/material-demo/', import.meta.url);
const MATERIAL_DEMO_FOCUS_URL = new URL(
  '../precomputeDemo/fixtures/material-demo-focus/',
  import.meta.url,
);

describe('precomputeFileDemo', () => {
  it('processes a descriptor without a factory wrapper', async () => {
    const descriptor: FileDemoDescriptor = {
      entries: {
        Default: {
          name: 'Default',
          url: new URL('BasicButtons.tsx', MATERIAL_DEMO_URL).href,
        },
      },
      name: 'Basic buttons',
      slug: 'basic-buttons',
    };

    const result = await precomputeFileDemo(descriptor, { output: 'hast' });

    expect(result.descriptor).toBe(descriptor);
    expect(result.code.Default).toMatchObject({
      extraFiles: {
        'helper.ts': { language: 'typescript' },
        'data.ts': { language: 'typescript', relativeUrl: './nested/data.ts' },
      },
      fileName: 'BasicButtons.tsx',
    });
    expect(result.externals).toEqual({
      react: [{ isType: undefined, name: 'React', type: 'namespace' }],
    });
  });

  it('preserves exact compatibility preview and host metadata', async () => {
    const descriptor: FileDemoDescriptor = {
      entries: {
        Default: { name: 'Default', url: 'file:///BasicButtons.tsx' },
      },
      metadata: {
        background: 'outlined',
        defaultCodeOpen: false,
        layout: { maxWidth: 480 },
      },
      name: 'Basic buttons',
      preview: {
        fileName: 'BasicButtons.tsx.preview',
        source: '<button type="button">Primary action</button>',
      },
      slug: 'basic-buttons',
    };
    const loadSource = vi.fn<LoadSource>(async () => ({
      source: 'export default function Demo() {}',
    }));

    const result = await precomputeFileDemo(descriptor, {
      loadSource,
      output: 'hast',
    });

    expect(result.descriptor.preview).toEqual({
      fileName: 'BasicButtons.tsx.preview',
      source: '<button type="button">Primary action</button>',
    });
    expect(result.descriptor.metadata).toEqual(descriptor.metadata);
  });

  it('derives focused source without a preview file', async () => {
    const descriptor: FileDemoDescriptor = {
      entries: {
        Default: {
          name: 'Default',
          url: new URL('BasicButtons.tsx', MATERIAL_DEMO_FOCUS_URL).href,
        },
      },
      name: 'Basic buttons',
      slug: 'basic-buttons',
    };

    const result = await precomputeFileDemo(descriptor, { output: 'hast' });
    const variant = result.code.Default;
    if (!variant || typeof variant === 'string') {
      throw new Error('Expected a precomputed variant');
    }

    expect(descriptor.preview).toBeUndefined();
    expect(decodeSourceToText(variant.source, variant.fallback)).not.toContain('@focus');
    expect(variant.collapsible).toBe(true);
    expect(variant.focusedLines).toBe(3);
  });

  it('uses descriptor entries as the source of variant names', async () => {
    const loadSource = vi.fn<LoadSource>(async (url) => ({ source: `source:${url}` }));
    const descriptor: FileDemoDescriptor = {
      entries: {
        Default: { name: 'Default', url: 'file:///Default.tsx' },
        Compact: { name: 'Compact', url: 'file:///Compact.tsx' },
      },
      name: 'Example',
      slug: 'example',
    };

    const result = await precomputeFileDemo(descriptor, {
      loadSource,
      output: 'hast',
      sourceEnhancers: [],
      sourceParser: Promise.resolve((source) => ({
        type: 'root',
        children: [{ type: 'text', value: source }],
      })),
    });

    expect(Object.keys(result.code)).toEqual(['Default', 'Compact']);
    expect(loadSource).toHaveBeenCalledTimes(2);
  });

  it('rejects entry names that differ from their descriptor keys', async () => {
    const descriptor: FileDemoDescriptor = {
      entries: {
        Default: { name: 'Other', url: 'file:///Default.tsx' },
      },
      name: 'Example',
      slug: 'example',
    };

    await expect(precomputeFileDemo(descriptor)).rejects.toThrow(
      'Demo entry "Default" has name "Other"; entry names must match descriptor keys',
    );
  });
});
