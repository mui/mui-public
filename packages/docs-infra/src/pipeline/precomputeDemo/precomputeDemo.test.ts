import { describe, expect, it, vi } from 'vitest';
import type {
  Code,
  Externals,
  LoadSource,
  ParseSource,
  SourceEnhancer,
  SourceTransformer,
  VariantCode,
} from '../../CodeHighlighter/types';
import { decodeSourceToText } from '../loadIsomorphicCodeVariant/decodeSourceToText';
import { loadIsomorphicCodeVariant } from '../loadIsomorphicCodeVariant';
import { precomputeDemo } from './precomputeDemo';

const parseSource: ParseSource = (source) => ({
  type: 'root',
  children: [{ type: 'text', value: source }],
});

/** Collects every class name emitted for the `Default` variant. */
function classNamesOf(result: { code: Code }): string[] {
  const variant = result.code.Default;
  if (
    !variant ||
    typeof variant === 'string' ||
    !variant.source ||
    typeof variant.source === 'string'
  ) {
    throw new Error('expected a highlighted HAST source');
  }

  const names = new Set<string>();
  const walk = (node: any) => {
    const className = node.properties?.className;
    if (className) {
      ([] as string[]).concat(className).forEach((name) => names.add(name));
    }
    (node.children ?? []).forEach(walk);
  };
  walk(variant.source);
  return [...names];
}

describe('precomputeDemo', () => {
  it('matches direct variant processing', async () => {
    const entryUrl = new URL('./fixtures/material-demo/BasicButtons.tsx', import.meta.url).href;
    const loadSource = vi.fn<LoadSource>(async () => ({ source: 'const value = true;' }));
    const sourceEnhancers: SourceEnhancer[] = [];
    const sourceParser = Promise.resolve(parseSource);
    const [precomputed, direct] = await Promise.all([
      precomputeDemo({
        entries: [{ name: 'Default', url: entryUrl }],
        loadSource,
        output: 'hast',
        sourceEnhancers,
        sourceParser,
      }),
      loadIsomorphicCodeVariant(entryUrl, 'Default', entryUrl, {
        loadSource,
        output: 'hast',
        sourceEnhancers,
        sourceParser,
      }),
    ]);

    expect(precomputed).toEqual({
      code: { Default: direct.code },
      dependencies: direct.dependencies,
      externals: direct.externals,
    });
  });

  it('loads entries without a factory wrapper', async () => {
    const loadSource = vi.fn<LoadSource>(async (url) => ({
      source: `source:${url}`,
      externals: {
        react: [{ name: 'React', type: 'namespace' }],
      },
    }));

    const result = await precomputeDemo({
      entries: [
        { name: 'Default', url: 'file:///demos/Default.tsx' },
        { name: 'Compact', url: 'file:///demos/Compact.tsx' },
      ],
      loadSource,
      sourceParser: Promise.resolve(parseSource),
      output: 'hast',
    });

    expect(Object.keys(result.code)).toEqual(['Default', 'Compact']);
    expect(result.code.Default).toMatchObject({
      fileName: 'Default.tsx',
      url: 'file:///demos/Default.tsx',
    });
    expect(result.code.Compact).toMatchObject({
      fileName: 'Compact.tsx',
      url: 'file:///demos/Compact.tsx',
    });
    expect(result.externals).toEqual({
      react: [{ name: 'React', type: 'namespace' }],
    });
    expect(result.dependencies).toEqual(['file:///demos/Default.tsx', 'file:///demos/Compact.tsx']);
  });

  it('passes named exports, transformers, enhancers, and loading options to each entry', async () => {
    const loadSource = vi.fn<LoadSource>(async () => ({
      source: 'const value: string = "test";',
    }));
    const transformer: SourceTransformer = {
      extensions: ['ts'],
      transformer: vi.fn(async () => ({
        js: { fileName: 'Custom.js', source: 'const value = "test";' },
      })),
    };
    const enhancer: SourceEnhancer = vi.fn((root) => root);

    const result = await precomputeDemo({
      entries: [
        {
          name: 'Default',
          url: 'file:///demos/source',
          fileName: 'Custom.ts',
          namedExport: 'Example',
        },
      ],
      loadSource,
      maxDepth: 2,
      output: 'hast',
      sourceEnhancers: [enhancer],
      sourceParser: Promise.resolve(parseSource),
      sourceTransformers: [transformer],
    });

    expect(result.code.Default).toMatchObject({
      fileName: 'Custom.ts',
      namedExport: 'Example',
      transforms: {
        js: { fileName: 'Custom.js' },
      },
    });
    expect(transformer.transformer).toHaveBeenCalledOnce();
    expect(enhancer).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate entry names before loading source', async () => {
    const loadSource = vi.fn<LoadSource>(async () => ({ source: '' }));

    await expect(
      precomputeDemo({
        entries: [
          { name: 'Default', url: 'file:///demos/First.tsx' },
          { name: 'Default', url: 'file:///demos/Second.tsx' },
        ],
        loadSource,
      }),
    ).rejects.toThrow('Duplicate demo entry name: Default');
    expect(loadSource).not.toHaveBeenCalled();
  });

  it('rejects entries whose filenames cannot be derived', async () => {
    await expect(
      precomputeDemo({ entries: [{ name: 'Default', url: 'file:///demos/' }] }),
    ).rejects.toThrow('Cannot determine fileName from URL "file:///demos/" for entry "Default"');
  });

  it('uses the default source pipeline', async () => {
    const result = await precomputeDemo({
      entries: [
        {
          name: 'Default',
          url: new URL('./fixtures/material-demo/BasicButtons.tsx', import.meta.url).href,
        },
      ],
      output: 'hast',
    });

    // Every file is presented as a sibling of the entry, whatever its position
    // on disk, with `relativeUrl` keeping the real location.
    expect(result.code.Default).toMatchObject({
      extraFiles: {
        'helper.ts': { language: 'typescript' },
        'data.ts': { language: 'typescript', relativeUrl: './nested/data.ts' },
      },
      fileName: 'BasicButtons.tsx',
      language: 'tsx',
    });
    expect(result.externals).toEqual({
      react: [{ isType: undefined, name: 'React', type: 'namespace' }],
    });
  });

  it('rewrites the imports of flattened files to match', async () => {
    const result = await precomputeDemo({
      entries: [
        {
          name: 'Default',
          url: new URL('./fixtures/material-demo/BasicButtons.tsx', import.meta.url).href,
        },
      ],
      output: 'hast',
    });
    const variant = result.code.Default;
    if (!variant || typeof variant === 'string') {
      throw new Error('Expected a precomputed variant');
    }
    const helper = variant.extraFiles?.['helper.ts'];
    if (!helper || typeof helper === 'string') {
      throw new Error('Expected a processed helper file');
    }

    // `helper.ts` imports `./nested/data` on disk; the reader sees a folder
    // where every file sits beside the entry, so the import has to match.
    expect(decodeSourceToText(helper.source, helper.fallback)).toContain("from './data'");
  });

  it('derives focused source from the one-file target fixture', async () => {
    const result = await precomputeDemo({
      entries: [
        {
          name: 'Default',
          url: new URL('./fixtures/material-demo-focus/BasicButtons.tsx', import.meta.url).href,
        },
      ],
      output: 'hast',
    });
    const variant = result.code.Default;
    if (!variant || typeof variant === 'string') {
      throw new Error('Expected a precomputed variant');
    }

    const source = decodeSourceToText(variant.source, variant.fallback);
    expect(source).not.toContain('@focus');
    expect(variant.collapsible).toBe(true);
    expect(variant.focusedLines).toBe(3);
  });

  it('deduplicates dependencies and merges externals', async () => {
    const loadSource = vi.fn<LoadSource>(async (url) => {
      if (url.endsWith('shared.ts')) {
        return { source: 'export const shared = true;' };
      }

      const externals: Externals = url.endsWith('First.tsx')
        ? { react: [{ name: 'React', type: 'namespace' as const }] }
        : {
            react: [{ name: 'useId', type: 'named' as const }],
            '@mui/material': [{ name: 'Button', type: 'named' as const }],
          };
      return {
        source: '',
        extraDependencies: ['file:///demos/shared.ts'],
        extraFiles: { 'shared.ts': 'file:///demos/shared.ts' },
        externals,
      };
    });

    const result = await precomputeDemo({
      entries: [
        { name: 'First', url: 'file:///demos/First.tsx' },
        { name: 'Second', url: 'file:///demos/Second.tsx' },
      ],
      loadSource,
      sourceParser: Promise.resolve(parseSource),
    });

    expect(result.dependencies).toEqual([
      'file:///demos/First.tsx',
      'file:///demos/shared.ts',
      'file:///demos/Second.tsx',
    ]);
    expect(result.externals).toEqual({
      react: [
        { name: 'React', type: 'namespace' },
        { name: 'useId', type: 'named' },
      ],
      '@mui/material': [{ name: 'Button', type: 'named' }],
    });
  });

  it('resolves a relative import to the sibling matching the importing language', async () => {
    // Demos that ship both languages import their data without an extension,
    // so the file doing the importing decides which sibling it reaches.
    const result = await precomputeDemo({
      entries: [
        {
          name: 'JS',
          url: new URL('./fixtures/material-demo-languages/BasicButtons.js', import.meta.url).href,
          language: 'jsx',
        },
        {
          name: 'TS',
          url: new URL('./fixtures/material-demo-languages/BasicButtons.tsx', import.meta.url).href,
        },
      ],
      output: 'hast',
    });

    expect(Object.keys((result.code.JS as VariantCode).extraFiles ?? {})).toEqual(['helper.js']);
    expect(Object.keys((result.code.TS as VariantCode).extraFiles ?? {})).toEqual(['helper.ts']);
  });

  it('highlights JSX in a `.js` entry without an override', async () => {
    // `.js` shares the grammar of the rest of the JavaScript family, so a file
    // holding JSX is classified the same way its TypeScript twin would be.
    const jsxInJsFile = new URL('./fixtures/material-demo/BasicButtons.js', import.meta.url).href;

    const result = await precomputeDemo({
      entries: [{ name: 'Default', url: jsxInJsFile }],
      output: 'hast',
    });

    // `pl-ent` is the element name and `di-ak` the attribute name.
    expect(classNamesOf(result)).toContain('pl-ent');
    expect(classNamesOf(result)).toContain('di-ak');
  });

  it('uses the entry language when the extension does not pick a grammar', async () => {
    const loadSource = vi.fn<LoadSource>(async () => ({
      source: 'const value = <button type="button" />;',
    }));

    const [byExtension, byLanguage] = await Promise.all([
      precomputeDemo({
        entries: [{ name: 'Default', url: 'file:///demos/Snippet.txt' }],
        loadSource,
        output: 'hast',
      }),
      precomputeDemo({
        entries: [{ name: 'Default', url: 'file:///demos/Snippet.txt', language: 'jsx' }],
        loadSource,
        output: 'hast',
      }),
    ]);

    expect(classNamesOf(byExtension)).not.toContain('pl-ent');
    expect(classNamesOf(byLanguage)).toContain('pl-ent');
  });
});
