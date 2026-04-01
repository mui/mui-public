import { describe, it, expect } from 'vitest';
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { encode, decode } from 'uint8-to-base64';
import { extractTypeProps } from '../loadServerTypes/extractTypeProps';
import { formatDetailedTypeAsHast } from '../loadServerTypes/typeHighlighting';
import {
  compressHast,
  decompressHast,
  compressHastAsync,
  decompressHastAsync,
  HAST_DICTIONARY,
} from './hastCompression';

describe('hastCompression', () => {
  const SAMPLE_HAST_JSON = JSON.stringify({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['pl-k'] },
                children: [{ type: 'text', value: 'interface' }],
              },
              { type: 'text', value: ' ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['pl-en'] },
                children: [{ type: 'text', value: 'ButtonProps' }],
              },
              { type: 'text', value: ' {\n  ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['pl-smi'] },
                children: [{ type: 'text', value: 'children' }],
              },
              { type: 'text', value: ': ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['pl-c1'] },
                children: [{ type: 'text', value: 'React.ReactNode' }],
              },
              { type: 'text', value: ';\n  ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['pl-smi'] },
                children: [{ type: 'text', value: 'disabled' }],
              },
              { type: 'text', value: '?: ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['pl-c1'] },
                children: [{ type: 'text', value: 'boolean' }],
              },
              { type: 'text', value: ';\n}' },
            ],
          },
        ],
      },
    ],
  });

  const SIMPLE_JSON = JSON.stringify({ hello: 'world' });

  const TYPE_PROP_HAST_JSON = JSON.stringify({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'], dataFrameType: 'comment' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['line'], dataLn: 1 },
            children: [{ type: 'text', value: 'The class name to apply to the root element.' }],
          },
        ],
      },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'], dataFrameType: 'property' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['line'], dataLn: 2 },
            children: [
              { type: 'text', value: 'className?: ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { dataType: 'TypeRef', name: 'NumberField.Root.State' },
                children: [{ type: 'text', value: 'NumberField.Root.State' }],
              },
              { type: 'text', value: ' | undefined' },
            ],
          },
        ],
      },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'], dataFrameType: 'property' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['line'], dataLn: 3 },
            children: [
              {
                type: 'text',
                value: '(state: NavigationMenu.Root.State) => React.CSSProperties | undefined',
              },
            ],
          },
        ],
      },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'], dataFrameType: 'property' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['line'], dataLn: 4 },
            children: [
              {
                type: 'text',
                value:
                  '(value: TValue | null, eventDetails: NavigationMenu.Root.ChangeEventDetails) => void',
              },
            ],
          },
        ],
      },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'], dataFrameType: 'property' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['line'], dataLn: 5 },
            children: [
              {
                type: 'text',
                value: '(props: HTMLProps, state: NavigationMenu.Root.State) => ReactElement',
              },
            ],
          },
        ],
      },
    ],
  });

  async function createExtractedHastJson(source: string): Promise<string> {
    const highlighted = await formatDetailedTypeAsHast(source);
    const extracted = extractTypeProps(highlighted);
    return JSON.stringify(extracted.hast);
  }

  describe('sync roundtrip', () => {
    it('compresses and decompresses HAST JSON to the original string', () => {
      const compressed = compressHast(SAMPLE_HAST_JSON);
      const decompressed = decompressHast(compressed);
      expect(decompressed).toBe(SAMPLE_HAST_JSON);
    });

    it('compresses and decompresses simple JSON', () => {
      const compressed = compressHast(SIMPLE_JSON);
      const decompressed = decompressHast(compressed);
      expect(decompressed).toBe(SIMPLE_JSON);
    });

    it('handles an empty string', () => {
      const compressed = compressHast('');
      const decompressed = decompressHast(compressed);
      expect(decompressed).toBe('');
    });
  });

  describe('async roundtrip', () => {
    it('compresses and decompresses HAST JSON to the original string', async () => {
      const compressed = await compressHastAsync(SAMPLE_HAST_JSON);
      const decompressed = await decompressHastAsync(compressed);
      expect(decompressed).toBe(SAMPLE_HAST_JSON);
    });

    it('compresses and decompresses simple JSON', async () => {
      const compressed = await compressHastAsync(SIMPLE_JSON);
      const decompressed = await decompressHastAsync(compressed);
      expect(decompressed).toBe(SIMPLE_JSON);
    });
  });

  describe('sync and async produce compatible results', () => {
    it('async compressed data can be decompressed synchronously', async () => {
      const compressed = await compressHastAsync(SAMPLE_HAST_JSON);
      const decompressed = decompressHast(compressed);
      expect(decompressed).toBe(SAMPLE_HAST_JSON);
    });

    it('sync compressed data can be decompressed asynchronously', async () => {
      const compressed = compressHast(SAMPLE_HAST_JSON);
      const decompressed = await decompressHastAsync(compressed);
      expect(decompressed).toBe(SAMPLE_HAST_JSON);
    });
  });

  describe('dictionary effectiveness', () => {
    it('produces smaller output than DEFLATE without a dictionary for HAST-like data', () => {
      const withDict = compressHast(SAMPLE_HAST_JSON);
      const withoutDict = encode(deflateSync(strToU8(SAMPLE_HAST_JSON), { level: 9 }));

      expect(withDict.length).toBeLessThan(withoutDict.length);
    });

    it('produces smaller output for repeated type-prop HAST patterns', () => {
      const withDict = compressHast(TYPE_PROP_HAST_JSON);
      const withoutDict = encode(deflateSync(strToU8(TYPE_PROP_HAST_JSON), { level: 9 }));

      expect(withDict.length).toBeLessThan(withoutDict.length);
    });

    it('produces smaller output for real extracted JSX and hooks payloads', async () => {
      const rawJson = await createExtractedHastJson(`{
  /** Hook-driven callback that returns JSX output */
  render?: (state: NavigationMenu.Root.State) => React.JSX.Element;
  /** Memoized JSX list for child items */
  getItems?: () => Array<JSX.Element>;
  /** State change callback from an interaction */
  onChange?: React.Dispatch<React.SetStateAction<string>>;
}`);

      const withDict = compressHast(rawJson);
      const withoutDict = encode(deflateSync(strToU8(rawJson), { level: 9 }));

      expect(rawJson).toContain('"dataFrameType":"comment"');
      expect(rawJson).toContain('"className":"frame"');
      expect(rawJson).toContain('"value":"React"');
      expect(rawJson).toContain('"value":"JSX"');
      expect(withDict.length).toBeLessThan(withoutDict.length);
    });

    it('produces smaller output for real extracted hook return-signature payloads', async () => {
      const rawJson = await createExtractedHastJson(`{
  /** Return signature from a stateful hook */
  useValue?: () => [value: string, setValue: Dispatch<React.SetStateAction<string>>];
  /** Stable callback returned from hook internals */
  useAction?: () => ReturnType<typeof React.useCallback<(value: string) => void>>;
  /** Memoized selector result from hook internals */
  useItems?: () => ReturnType<typeof React.useMemo<Array<string>>>;
}`);

      const withDict = compressHast(rawJson);
      const withoutDict = encode(deflateSync(strToU8(rawJson), { level: 9 }));

      expect(rawJson).toContain('"dataFrameType":"comment"');
      expect(rawJson).toContain('"className":"frame"');
      expect(rawJson).toContain('"value":"Dispatch"');
      expect(rawJson).toContain('"value":"SetStateAction"');
      expect(withDict.length).toBeLessThan(withoutDict.length);
    });

    it('produces smaller output for real extracted type-prop HAST payloads', async () => {
      const highlighted = await formatDetailedTypeAsHast(`{
  /** Whether the button is interactive */
  disabled?: boolean;
  /** Optional inline style override */
  style?: React.CSSProperties;
  /** Render props for a navigation menu item */
  render?: (props: HTMLProps, state: NavigationMenu.Root.State) => ReactElement;
}`);

      const extracted = extractTypeProps(highlighted);
      const rawJson = JSON.stringify(extracted.hast);
      const withDict = compressHast(rawJson);
      const withoutDict = encode(deflateSync(strToU8(rawJson), { level: 9 }));

      expect(rawJson).toContain('"dataFrameType":"comment"');
      expect(rawJson).toContain('"value":"NavigationMenu"');
      expect(rawJson).toContain('"value":"Root"');
      expect(rawJson).toContain('"value":"State"');
      expect(rawJson).toContain('"dataLn":');
      expect(withDict.length).toBeLessThan(withoutDict.length);
    });

    it('may not help (or even hurt) for data that does not match the dictionary', () => {
      // Random-ish data unlikely to benefit from the HAST dictionary
      const randomData = JSON.stringify(
        Array.from({ length: 200 }, (_, i) => ({
          id: `item-${i}`,
          score: Math.sin(i) * 1000,
          tags: [`alpha-${i}`, `beta-${i}`],
        })),
      );

      const withDict = compressHast(randomData);
      const withoutDict = encode(deflateSync(strToU8(randomData), { level: 9 }));

      // The dictionary-compressed version should not be dramatically larger
      // (DEFLATE gracefully ignores an unhelpful dictionary), but it does not
      // need to be smaller either.
      expect(withDict.length).toBeLessThan(withoutDict.length * 1.1);
    });

    it('keeps the raw dictionary under the intended size budget', () => {
      expect(HAST_DICTIONARY.byteLength).toBeLessThan(4 * 1024);
    });
  });

  describe('dictionary mutation tolerance', () => {
    it('can still decompress after prepending new entries to the dictionary', () => {
      const compressed = compressHast(SAMPLE_HAST_JSON);

      // DEFLATE dictionaries use only the *last* 32 KiB of the buffer, so
      // prepending keeps the tail identical and existing payloads still work.
      const extraEntries = 'SomeNewComponent,anotherProp,data-extra';
      const prependedDict = new Uint8Array(extraEntries.length + HAST_DICTIONARY.length);
      prependedDict.set(strToU8(extraEntries), 0);
      prependedDict.set(HAST_DICTIONARY, extraEntries.length);

      const raw = decode(compressed);
      const decompressed = strFromU8(inflateSync(raw, { dictionary: prependedDict }));
      expect(decompressed).toBe(SAMPLE_HAST_JSON);
    });

    it('fails to decompress when dictionary entries are removed', () => {
      const compressed = compressHast(SAMPLE_HAST_JSON);

      // Use a truncated dictionary (remove the last 500 bytes)
      const truncatedDict = HAST_DICTIONARY.slice(0, HAST_DICTIONARY.length - 500);

      // DEFLATE may throw with a wrong dictionary, or it may decode to
      // corrupted bytes. Either outcome means the payload is unusable.
      const raw = decode(compressed);
      let output: string;
      try {
        output = strFromU8(inflateSync(raw, { dictionary: truncatedDict }));
      } catch {
        return;
      }
      expect(output).not.toBe(SAMPLE_HAST_JSON);
    });

    it('produces corrupted output when dictionary entries are reordered', () => {
      const compressed = compressHast(SAMPLE_HAST_JSON);

      // Reverse the dictionary bytes — same content, different order
      const reversed = new Uint8Array(HAST_DICTIONARY.length);
      for (let i = 0; i < HAST_DICTIONARY.length; i += 1) {
        reversed[i] = HAST_DICTIONARY[HAST_DICTIONARY.length - 1 - i];
      }

      // DEFLATE may not throw with a wrong dictionary — it can silently
      // produce garbage. We verify the output is not the original.
      const raw = decode(compressed);
      let output: string;
      try {
        output = strFromU8(inflateSync(raw, { dictionary: reversed }));
      } catch {
        // Throwing is also acceptable — the data is unusable either way
        return;
      }
      expect(output).not.toBe(SAMPLE_HAST_JSON);
    });
  });
});
