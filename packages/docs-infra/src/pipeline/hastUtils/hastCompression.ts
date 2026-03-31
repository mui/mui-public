import { deflateSync, deflate, inflateSync, inflate, strToU8, strFromU8 } from 'fflate';
import { encode, decode } from 'uint8-to-base64';

/**
 * Shared dictionary for DEFLATE compression of HAST JSON.
 *
 * Contains byte sequences that frequently appear in JSON-serialized HAST trees
 * (syntax-highlighted TypeScript type documentation). The dictionary is
 * embedded in both the server build and the client bundle, so it must stay
 * small — currently ~3 KB uncompressed.
 *
 * IMPORTANT: Changing this dictionary is a **breaking change** for any
 * previously-compressed payloads. When the dictionary is updated, all cached
 * or persisted `hastCompressed` strings become undecodable. Bump the dictionary only
 * between major precomputed data regeneration cycles.
 */
const HAST_DICTIONARY = strToU8(
  [
    // JSON structural patterns (most frequent first)
    '{"type":"element","tagName":"span","properties":{"className":["',
    '{"type":"element","tagName":"a","properties":{"href":"',
    '{"type":"text","value":"',
    '"children":[',
    '"properties":{}',
    '"tagName":"code"',
    '"tagName":"pre"',
    '"type":"root"',
    '"type":"element"',
    '"type":"text"',
    // Starry Night / Pretty Lights class names (full set)
    'pl-c1',
    'pl-c2',
    'pl-c',
    'pl-corl',
    'pl-cce',
    'pl-en',
    'pl-ent',
    'pl-e',
    'pl-k',
    'pl-smi',
    'pl-smw',
    'pl-s1',
    'pl-sre',
    'pl-sra',
    'pl-sr',
    'pl-s',
    'pl-pds',
    'pl-pse',
    'pl-v',
    'pl-bu',
    'pl-ii',
    'pl-ml',
    'pl-mh',
    'pl-ms',
    'pl-mi1',
    'pl-mi2',
    'pl-mi',
    'pl-mb',
    'pl-md',
    'pl-mc',
    'pl-mdr',
    'pl-ba',
    'pl-sg',
    // Frame & line structure
    '"className":["frame"]',
    '"className":["line"]',
    '"dataFrameType":"highlighted"',
    '"dataFrameIndent":',
    '"dataLn":',
    // Common TypeScript keywords (appear as highlighted spans)
    'interface',
    'export',
    'import',
    'function',
    'return',
    'extends',
    'implements',
    'class',
    'typeof',
    'keyof',
    'readonly',
    'abstract',
    'public',
    'private',
    'protected',
    'static',
    'async',
    'await',
    'const',
    'true',
    'false',
    'never',
    'any',
    'unknown',
    'type',
    // Common TypeScript primitive and utility types
    'string',
    'number',
    'boolean',
    'undefined',
    'null',
    'object',
    'void',
    'Array',
    'Record',
    'Partial',
    'Required',
    'Readonly',
    'Pick',
    'Omit',
    'Exclude',
    'Extract',
    'NonNullable',
    'ReturnType',
    'Parameters',
    'Promise',
    // Common React types
    'React.ReactNode',
    'React.ReactElement',
    'React.HTMLAttributes',
    'React.AriaAttributes',
    'React.CSSProperties',
    'React.ComponentPropsWithRef',
    'React.Ref',
    'React.RefObject',
    'React.ElementRef',
    'React.ComponentProps',
    'React.FC',
    'React.Dispatch',
    'React.SetStateAction',
    // Common DOM types
    'HTMLElement',
    'HTMLDivElement',
    'HTMLButtonElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLAnchorElement',
    'HTMLFormElement',
    'HTMLSpanElement',
    'HTMLLabelElement',
    'Element',
    'EventTarget',
    // Common event types
    'MouseEvent',
    'ChangeEvent',
    'KeyboardEvent',
    'FocusEvent',
    'FormEvent',
    'PointerEvent',
    'TouchEvent',
    // Common punctuation patterns in type signatures
    ' | ',
    ' & ',
    ' => ',
    '{ ',
    ' }',
    '(): ',
    '(event: ',
    ': string',
    ': number',
    ': boolean',
    ': void',
    // Common prop names (from typeOrder)
    'className',
    'children',
    'disabled',
    'style',
    'render',
    'defaultValue',
    'value',
    'onValueChange',
    'defaultOpen',
    'open',
    'onOpenChange',
    'defaultChecked',
    'checked',
    'onCheckedChange',
    'orientation',
    'keepMounted',
    'required',
    'readOnly',
    'name',
    'label',
    'container',
    'anchor',
    'align',
    'side',
    'sideOffset',
    'alignOffset',
    // Common data attributes
    'data-disabled',
    'data-open',
    'data-closed',
    'data-checked',
    'data-unchecked',
    'data-pressed',
    'data-selected',
    'data-highlighted',
    'data-orientation',
    'data-valid',
    'data-invalid',
    'data-required',
    'data-readonly',
    // Common component part names
    'Root',
    'Trigger',
    'Popup',
    'Positioner',
    'Portal',
    'Arrow',
    'Content',
    'Item',
    'Indicator',
    'Group',
    'Track',
    'Thumb',
    // Common type suffixes
    'Props',
    'DataAttributes',
    'CssVars',
  ].join(''),
);

/**
 * Compress a JSON string using DEFLATE with the shared HAST dictionary.
 * Returns a base64-encoded string suitable for embedding in serialized props.
 */
export function compressHast(json: string): string {
  return encode(deflateSync(strToU8(json), { level: 9, dictionary: HAST_DICTIONARY }));
}

/**
 * Decompress a base64-encoded DEFLATE payload that was compressed with
 * `compressHast`. Returns the original JSON string.
 *
 * Throws if the payload was not compressed with the matching dictionary.
 */
export function decompressHast(base64: string): string {
  return strFromU8(inflateSync(decode(base64), { dictionary: HAST_DICTIONARY }));
}

/**
 * Compress a string asynchronously using DEFLATE with the shared HAST dictionary.
 * Returns a base64-encoded string.
 */
export function compressHastAsync(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    deflate(
      strToU8(input),
      { consume: true, level: 9, dictionary: HAST_DICTIONARY },
      (err, output) => {
        if (err) {
          reject(err);
        } else {
          resolve(encode(output));
        }
      },
    );
  });
}

/**
 * Decompress a base64-encoded DEFLATE payload asynchronously.
 * Returns the original JSON string.
 */
export function decompressHastAsync(base64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    inflate(decode(base64), { consume: true, dictionary: HAST_DICTIONARY }, (err, output) => {
      if (err) {
        reject(err);
      } else {
        resolve(strFromU8(output));
      }
    });
  });
}
