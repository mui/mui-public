import { describe, it, expect } from 'vitest';
import { diff } from 'jsondiffpatch';
import type { Code, HastRoot, Transforms } from '../CodeHighlighter/types';
import { toControlledCode } from './SourceEditingEngine';
import { stringOrHastToString, frameFallbackFromSpans } from '../pipeline/hastUtils';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import {
  splitTransformsForEmbed,
  embedTransformsInRoot,
} from '../pipeline/loadIsomorphicCodeVariant/embedTransforms';
import { applyCodeTransform } from '../pipeline/loadIsomorphicCodeVariant/applyCodeTransform';

const transformDeps = { decode: decodeHastSource, frameFallbackFromSpans };

function hastRootOf(content: string): HastRoot {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [{ type: 'text', value: content }],
      },
    ],
  };
}

/**
 * Builds a variant the way the precompute pipeline ships it: hast source with
 * the transform delta embedded in `root.data.transforms` and a delta-less
 * `hasDelta: true` manifest entry on the variant.
 */
function buildEmbeddedVariant(tsSource: string, jsSource: string, jsFileName: string) {
  const source = hastRootOf(tsSource);
  const transformed = hastRootOf(jsSource);
  const raw: Transforms = { js: { delta: diff(source, transformed), fileName: jsFileName } };
  const split = splitTransformsForEmbed(raw);
  if (!split) {
    throw new Error('fixture produced no transforms');
  }
  embedTransformsInRoot(source, split.embedded);
  return { source, manifest: split.manifest };
}

describe('toControlledCode transform materialization', () => {
  const tsSource = 'const a: number = 1;\nconst b: string = "x";';
  const jsSource = 'const a = 1;\nconst b = "x";';

  it('materializes line deltas for embedded hast transforms on the main file', () => {
    const { source, manifest } = buildEmbeddedVariant(tsSource, jsSource, 'Demo.js');
    const code: Code = {
      Default: { fileName: 'Demo.tsx', url: '/demo', source, transforms: manifest },
    };

    const controlled = toControlledCode(
      code,
      'Default',
      undefined,
      stringOrHastToString,
      transformDeps,
    );
    const variant = controlled.Default!;

    expect(variant.source).toBe(tsSource);
    expect(variant.transforms?.js?.delta).toBeDefined();
    // The materialized delta must reproduce the transformed source through the
    // plain-string patch path used after seeding.
    expect(applyCodeTransform(variant.source as string, variant.transforms!, 'js')).toBe(jsSource);
  });

  it('materializes line deltas for embedded hast transforms on extra files', () => {
    const { source, manifest } = buildEmbeddedVariant(tsSource, jsSource, 'helper.js');
    const code: Code = {
      Default: {
        fileName: 'Demo.tsx',
        url: '/demo',
        source: 'const main = true;',
        extraFiles: { 'helper.ts': { source, transforms: manifest } },
      },
    };

    const controlled = toControlledCode(
      code,
      'Default',
      undefined,
      stringOrHastToString,
      transformDeps,
    );
    const extra = controlled.Default!.extraFiles!['helper.ts'];

    expect(extra.source).toBe(tsSource);
    expect(extra.transforms?.js?.delta).toBeDefined();
    expect(applyCodeTransform(extra.source as string, extra.transforms!, 'js')).toBe(jsSource);
  });

  it('leaves string-source transforms and rename-only entries untouched', () => {
    const stringTransforms: Transforms = {
      js: { delta: [[jsSource]], fileName: 'Demo.js', hasDelta: true },
      rename: { fileName: 'Demo.mjs', hasDelta: false },
    };
    const code: Code = {
      Default: {
        fileName: 'Demo.tsx',
        url: '/demo',
        source: tsSource,
        transforms: stringTransforms,
      },
    };

    const controlled = toControlledCode(
      code,
      'Default',
      undefined,
      stringOrHastToString,
      transformDeps,
    );

    expect(controlled.Default!.transforms).toEqual(stringTransforms);
  });

  it('converts without deps exactly as before', () => {
    const { source, manifest } = buildEmbeddedVariant(tsSource, jsSource, 'Demo.js');
    const code: Code = {
      Default: { fileName: 'Demo.tsx', url: '/demo', source, transforms: manifest },
    };

    const controlled = toControlledCode(code, 'Default', undefined, stringOrHastToString);

    expect(controlled.Default!.source).toBe(tsSource);
    expect(controlled.Default!.transforms?.js?.delta).toBeUndefined();
  });
});
