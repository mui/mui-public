import { compressString } from '@mui/internal-docs-infra/pipeline/hastUtils';

export interface Comment {
  author: string;
  text: string;
}

export interface TextNode {
  type: 'text';
  value: string;
}

export interface MarkNode {
  type: 'element';
  tagName: 'mark';
  properties: { comments: Comment[] };
  children: TextNode[];
}

export interface DocumentRoot {
  type: 'root';
  children: Array<TextNode | MarkNode>;
}

// The sizes the fallback hoists so the content can report the saving without
// re-measuring — and so the swap carries structured metadata, not just a string.
export interface Hoisted {
  dictionary: string;
  plainBytes: number;
  uncompressedBytes: number;
  compressedBytes: number;
}

// The plain prose — what the placeholder paints, and the dictionary the
// compressed comment layer is decoded against.
export const PROSE =
  'The team gathers feedback before each release, then reviews every change together. ' +
  'Small fixes ship quickly, while larger proposals wait for a second opinion.';

// The same prose, marked up with comment threads. Its text nodes concatenate
// back to PROSE verbatim — only the <mark> structure and the comment text are
// new — so deflating it against PROSE leaves little more than that delta.
export const DOCUMENT: DocumentRoot = {
  type: 'root',
  children: [
    { type: 'text', value: 'The team gathers feedback before each release, then ' },
    {
      type: 'element',
      tagName: 'mark',
      properties: {
        comments: [{ author: 'Alice Stone', text: 'Could we link the feedback form here?' }],
      },
      children: [{ type: 'text', value: 'reviews every change together' }],
    },
    { type: 'text', value: '. Small fixes ship quickly, while ' },
    {
      type: 'element',
      tagName: 'mark',
      properties: {
        comments: [
          { author: 'Bob Reyes', text: 'A second opinion from whom — the maintainers?' },
          { author: 'Carol Ng', text: 'Maintainers, yes. I will clarify it in the next draft.' },
        ],
      },
      children: [{ type: 'text', value: 'larger proposals wait for a second opinion' }],
    },
    { type: 'text', value: '.' },
  ],
};

export const RAW = JSON.stringify(DOCUMENT);
export const COMPRESSED = compressString(RAW, PROSE);

// Real wire sizes, in UTF-8 bytes.
const byteLength = (value: string) => new TextEncoder().encode(value).length;
export const PLAIN_BYTES = byteLength(PROSE);
export const UNCOMPRESSED_BYTES = byteLength(RAW);
export const COMPRESSED_BYTES = byteLength(COMPRESSED);

// The whole hoisted payload, built once from the constants above.
export const HOISTED: Hoisted = {
  dictionary: PROSE,
  plainBytes: PLAIN_BYTES,
  uncompressedBytes: UNCOMPRESSED_BYTES,
  compressedBytes: COMPRESSED_BYTES,
};
