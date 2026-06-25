import { create } from 'jsondiffpatch';
import type { Delta } from 'jsondiffpatch';
import { toText } from 'hast-util-to-text';
import type { Nodes as HastNodes } from 'hast';
import type {
  VariantSource,
  SourceComments,
  SourceTransformers,
  Transforms,
} from '../../CodeHighlighter/types';
import { decompressHastAsync } from '../hastUtils';

const differ = create({ omitRemovedValues: true, cloneDiffValues: true });

export async function transformSource(
  source: VariantSource,
  fileName: string,
  sourceTransformers: SourceTransformers,
  comments?: SourceComments,
): Promise<Transforms | undefined> {
  // Find applicable transformers up front so we can short-circuit before
  // doing any source decoding work.
  const applicableTransformers = sourceTransformers.filter(({ extensions }) =>
    extensions.some((ext) => fileName.endsWith(`.${ext}`)),
  );
  if (applicableTransformers.length === 0) {
    return undefined;
  }

  // Decode the source string and split it once. Both are independent of
  // which transformer is running, so doing this per-transformer (as the
  // previous implementation did) wasted work proportional to the number
  // of registered transformers.
  let sourceString: string;
  if (typeof source === 'string') {
    sourceString = source;
  } else if ('hastJson' in source) {
    sourceString = toText(JSON.parse(source.hastJson) as HastNodes);
  } else if ('hastCompressed' in source) {
    sourceString = toText(
      JSON.parse(await decompressHastAsync(source.hastCompressed)) as HastNodes,
    );
  } else {
    sourceString = toText(source);
  }
  const splitSource = sourceString.split('\n');

  const transforms = await Promise.all(
    applicableTransformers.map(async ({ transformer }) => {
      try {
        const transformed = await transformer(sourceString, fileName, comments);
        if (transformed) {
          const reduced = Object.keys(transformed).reduce<
            Record<
              string,
              { delta?: Delta; fileName?: string; comments?: SourceComments; hasDelta?: boolean }
            >
          >((acc, key) => {
            const entry = transformed[key];
            const delta = differ.diff(splitSource, entry.source.split('\n'));

            // Comments are 1-indexed everywhere, including transformer input and output
            // (keyed against the transformed source's 1-indexed lines).
            const transformedComments = entry.comments;

            const hasDelta = !!delta && typeof delta === 'object' && Object.keys(delta).length > 0;
            const renamed = !!entry.fileName && entry.fileName !== fileName;

            // Drop entries that neither change the source nor rename the
            // file — there's nothing for the runtime to apply.
            if (!hasDelta && !renamed) {
              return acc;
            }

            acc[key] = {
              ...(hasDelta && { delta, hasDelta: true }),
              ...(entry.fileName !== undefined && { fileName: entry.fileName }),
              ...(transformedComments && { comments: transformedComments }),
            };
            return acc;
          }, {});
          // If every entry was dropped (e.g. a transformer that only
          // produced noop entries), surface `undefined` so the caller
          // treats the variant as untransformed.
          return Object.keys(reduced).length > 0 ? reduced : undefined;
        }

        return undefined;
      } catch (error) {
        throw new Error(
          `Failed to transform source code (file: ${fileName}): ${error instanceof Error && error.message}`,
        );
      }
    }),
  );

  if (transforms.length === 0 || transforms.every((t) => t === undefined)) {
    return undefined;
  }

  return transforms.reduce<Transforms>((acc, transform) => {
    if (transform) {
      Object.entries(transform).forEach(([key, value]) => {
        if (acc[key]) {
          throw new Error(`Duplicate key found in source transformations: ${key}`);
        }

        acc[key] = value;
      });
    }
    return acc;
  }, {});
}
