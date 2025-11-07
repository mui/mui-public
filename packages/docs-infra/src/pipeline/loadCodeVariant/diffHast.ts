import { create, patch } from 'jsondiffpatch';
import type { Nodes } from 'hast';
import { ParseSource, Transforms } from '../../CodeHighlighter/types';

const differ = create({ omitRemovedValues: true, cloneDiffValues: true });

export async function diffHast(
  source: string,
  parsedSource: Nodes,
  filename: string,
  transforms: Transforms,
  parseSource: ParseSource,
): Promise<Record<string, any>> {
  const transformed = await Promise.all(
    Object.entries(transforms).map(async ([key, transform]) => {
      const patched = patch(source.split('\n'), transform.delta);
      if (!Array.isArray(patched)) {
        throw new Error(`Patch for ${key} did not return an array`);
      }

      const transformedSource = patched.join('\n');
      const parsedTransform = await parseSource(transformedSource, transform.fileName || filename);

      // TODO: further optimize this delta, it looks a little noisy
      const delta = differ.diff(parsedSource, parsedTransform);

      return {
        [key]: {
          ...transform,
          delta,
        },
      };
    }),
  );

  return Object.assign({}, ...transformed);
}
