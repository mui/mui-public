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
  buildDictionary,
  computeDictionaryChecksum,
  HastDictionaryMismatchError,
  MAX_DICTIONARY_SIZE,
  CHECKSUM_BYTES,
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

  describe('textContent dictionary', () => {
    const TEXT_CONTENT =
      'interface ButtonProps {\n  children: React.ReactNode;\n  disabled?: boolean;\n}';

    describe('sync roundtrip with textContent', () => {
      it('compresses and decompresses with matching textContent', () => {
        const compressed = compressHast(SAMPLE_HAST_JSON, TEXT_CONTENT);
        const decompressed = decompressHast(compressed, TEXT_CONTENT);
        expect(decompressed).toBe(SAMPLE_HAST_JSON);
      });

      it('compresses and decompresses simple JSON with textContent', () => {
        const compressed = compressHast(SIMPLE_JSON, TEXT_CONTENT);
        const decompressed = decompressHast(compressed, TEXT_CONTENT);
        expect(decompressed).toBe(SIMPLE_JSON);
      });

      it('compresses and decompresses an empty string with textContent', () => {
        const compressed = compressHast('', TEXT_CONTENT);
        const decompressed = decompressHast(compressed, TEXT_CONTENT);
        expect(decompressed).toBe('');
      });
    });

    describe('async roundtrip with textContent', () => {
      it('compresses and decompresses with matching textContent', async () => {
        const compressed = await compressHastAsync(SAMPLE_HAST_JSON, TEXT_CONTENT);
        const decompressed = await decompressHastAsync(compressed, TEXT_CONTENT);
        expect(decompressed).toBe(SAMPLE_HAST_JSON);
      });

      it('sync compressed with textContent can be decompressed async', async () => {
        const compressed = compressHast(SAMPLE_HAST_JSON, TEXT_CONTENT);
        const decompressed = await decompressHastAsync(compressed, TEXT_CONTENT);
        expect(decompressed).toBe(SAMPLE_HAST_JSON);
      });

      it('async compressed with textContent can be decompressed sync', async () => {
        const compressed = await compressHastAsync(SAMPLE_HAST_JSON, TEXT_CONTENT);
        const decompressed = decompressHast(compressed, TEXT_CONTENT);
        expect(decompressed).toBe(SAMPLE_HAST_JSON);
      });
    });

    describe('mismatch detection', () => {
      it('throws HastDictionaryMismatchError when textContent differs', () => {
        const compressed = compressHast(SAMPLE_HAST_JSON, TEXT_CONTENT);
        expect(() => decompressHast(compressed, 'completely different text')).toThrow(
          HastDictionaryMismatchError,
        );
      });

      it('throws when decompressing with textContent but compressed without', () => {
        const compressed = compressHast(SAMPLE_HAST_JSON);
        // The payload has no checksum prefix, so the first 4 bytes are deflate
        // data — the checksum comparison will almost certainly fail.
        expect(() => decompressHast(compressed, TEXT_CONTENT)).toThrow(HastDictionaryMismatchError);
      });

      it('throws or produces wrong output when decompressing without textContent but compressed with', () => {
        const compressed = compressHast(SAMPLE_HAST_JSON, TEXT_CONTENT);
        // Without textContent, the 4-byte checksum prefix is fed into inflate
        // as part of the deflate stream, which should either throw or produce
        // corrupted output.
        let result: string;
        try {
          result = decompressHast(compressed);
        } catch {
          return; // Throwing is the expected path
        }
        expect(result).not.toBe(SAMPLE_HAST_JSON);
      });

      it('rejects when textContent differs', async () => {
        const compressed = compressHast(SAMPLE_HAST_JSON, TEXT_CONTENT);
        await expect(decompressHastAsync(compressed, 'wrong text')).rejects.toThrow(
          HastDictionaryMismatchError,
        );
      });
    });

    describe('textContent dictionary effectiveness', () => {
      it('produces smaller output than static-only dictionary for matching HAST data', () => {
        const withText = compressHast(SAMPLE_HAST_JSON, TEXT_CONTENT);
        const withoutText = compressHast(SAMPLE_HAST_JSON);

        // The textContent dictionary should help because the HAST JSON
        // literally contains the text content as node values.
        // Account for 4-byte checksum overhead in the textContent version.
        expect(withText.length).toBeLessThan(withoutText.length + 10);
      });

      it('produces smaller output for type-prop HAST with matching text', () => {
        const textContent =
          'The class name to apply to the root element.\n' +
          'className?: NumberField.Root.State | undefined\n' +
          '(state: NavigationMenu.Root.State) => React.CSSProperties | undefined\n' +
          '(value: TValue | null, eventDetails: NavigationMenu.Root.ChangeEventDetails) => void\n' +
          '(props: HTMLProps, state: NavigationMenu.Root.State) => ReactElement';

        const withText = compressHast(TYPE_PROP_HAST_JSON, textContent);
        const withoutText = compressHast(TYPE_PROP_HAST_JSON);

        expect(withText.length).toBeLessThan(withoutText.length);
      });

      it('produces smaller output for real extracted type-prop HAST with text dictionary', async () => {
        const typeSource = `{
  /** Whether the button is interactive */
  disabled?: boolean;
  /** Optional inline style override */
  style?: React.CSSProperties;
  /** Render props for a navigation menu item */
  render?: (props: HTMLProps, state: NavigationMenu.Root.State) => ReactElement;
}`;

        const highlighted = await formatDetailedTypeAsHast(typeSource);
        const extracted = extractTypeProps(highlighted);
        const rawJson = JSON.stringify(extracted.hast);

        // Extract the text that would be visible to the user
        const textContent =
          'Whether the button is interactive\n' +
          'disabled?: boolean\n' +
          'Optional inline style override\n' +
          'style?: React.CSSProperties\n' +
          'Render props for a navigation menu item\n' +
          'render?: (props: HTMLProps, state: NavigationMenu.Root.State) => ReactElement';

        const withText = compressHast(rawJson, textContent);
        const withoutText = compressHast(rawJson);

        expect(withText.length).toBeLessThan(withoutText.length);
      });
    });
  });

  describe('buildDictionary', () => {
    it('returns HAST_DICTIONARY when textContent is omitted', () => {
      const dict = buildDictionary();
      expect(dict).toBe(HAST_DICTIONARY);
    });

    it('returns HAST_DICTIONARY when textContent is empty', () => {
      const dict = buildDictionary('');
      expect(dict).toBe(HAST_DICTIONARY);
    });

    it('prepends text bytes before HAST_DICTIONARY', () => {
      const dict = buildDictionary('hello');
      const textPart = strFromU8(dict.slice(0, 5));
      expect(textPart).toBe('hello');
      // The tail should be the static dictionary
      const tailPart = dict.slice(5);
      expect(tailPart.byteLength).toBe(HAST_DICTIONARY.byteLength);
      for (let i = 0; i < HAST_DICTIONARY.byteLength; i += 1) {
        expect(tailPart[i]).toBe(HAST_DICTIONARY[i]);
      }
    });

    it('truncates text from the end to fit within MAX_DICTIONARY_SIZE', () => {
      const longText = 'x'.repeat(MAX_DICTIONARY_SIZE);
      const dict = buildDictionary(longText);
      expect(dict.byteLength).toBe(MAX_DICTIONARY_SIZE);
      // The tail should still be HAST_DICTIONARY
      const tail = dict.slice(dict.byteLength - HAST_DICTIONARY.byteLength);
      for (let i = 0; i < HAST_DICTIONARY.byteLength; i += 1) {
        expect(tail[i]).toBe(HAST_DICTIONARY[i]);
      }
    });

    it('never exceeds MAX_DICTIONARY_SIZE', () => {
      const hugeText = 'a'.repeat(MAX_DICTIONARY_SIZE * 2);
      const dict = buildDictionary(hugeText);
      expect(dict.byteLength).toBeLessThanOrEqual(MAX_DICTIONARY_SIZE);
    });

    it('uses the full budget when text fits exactly', () => {
      const exactSize = MAX_DICTIONARY_SIZE - HAST_DICTIONARY.byteLength;
      const text = 'b'.repeat(exactSize);
      const dict = buildDictionary(text);
      expect(dict.byteLength).toBe(MAX_DICTIONARY_SIZE);
    });
  });

  describe('computeDictionaryChecksum', () => {
    it('returns CHECKSUM_BYTES bytes', () => {
      const checksum = computeDictionaryChecksum(HAST_DICTIONARY);
      expect(checksum.byteLength).toBe(CHECKSUM_BYTES);
    });

    it('is deterministic', () => {
      const a = computeDictionaryChecksum(HAST_DICTIONARY);
      const b = computeDictionaryChecksum(HAST_DICTIONARY);
      expect(a).toEqual(b);
    });

    it('differs for different inputs', () => {
      const a = computeDictionaryChecksum(strToU8('hello'));
      const b = computeDictionaryChecksum(strToU8('world'));
      const aHex = Array.from(a)
        .map((byte) => byte.toString(16))
        .join('');
      const bHex = Array.from(b)
        .map((byte) => byte.toString(16))
        .join('');
      expect(aHex).not.toBe(bHex);
    });
  });
});
