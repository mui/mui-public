import { create, Delta } from 'jsondiffpatch';
import { toText } from 'hast-util-to-text';
import { AsyncInflateOptions, decompress, strFromU8 } from 'fflate';
import { decode } from 'uint8-to-base64';
import type { Nodes as HastNodes } from 'hast';
import type { VariantSource, SourceTransformers, Transforms } from './types';

const differ = create({ omitRemovedValues: true, cloneDiffValues: true });

function decompressAsync(
  input: Uint8Array,
  options: AsyncInflateOptions = {},
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    decompress(input, options, (err, output) => {
      if (err) {
        reject(err);
      } else {
        resolve(output);
      }
    });
  });
}

export async function transformSource(
  source: VariantSource,
  fileName: string,
  sourceTransformers: SourceTransformers,
): Promise<Transforms | undefined> {
  const transforms = await Promise.all(
    sourceTransformers.map(async ({ extensions, transformer }) => {
      if (!extensions.some((ext) => fileName.endsWith(`.${ext}`))) {
        return undefined;
      }

      try {
        let sourceString: string;
        if (typeof source === 'string') {
          sourceString = source;
        } else if ('hastJson' in source) {
          sourceString = toText(JSON.parse(source.hastJson) as HastNodes);
        } else if ('hastGzip' in source) {
          const decompressed = strFromU8(
            await decompressAsync(decode(source.hastGzip), { consume: true }),
          );
          sourceString = toText(JSON.parse(decompressed) as HastNodes);
        } else {
          sourceString = toText(source);
        }

        const transformed = await transformer(sourceString, fileName);
        if (transformed) {
          const splitSource = sourceString.split('\n');
          return Object.keys(transformed).reduce<
            Record<string, { delta: Delta; fileName?: string }>
          >((acc, key) => {
            const delta = differ.diff(splitSource, transformed[key].source.split('\n'));

            acc[key] = { delta, fileName: transformed[key].fileName };
            return acc;
          }, {});
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
