import { strToU8 } from 'fflate';

/**
 * Maximum size of the DEFLATE dictionary in bytes.
 *
 * DEFLATE uses only the last 32 KiB of the dictionary buffer.
 * Any content beyond this limit is ignored by the compressor.
 */
export const MAX_DICTIONARY_SIZE = 32 * 1024;

/**
 * Checksum byte length embedded in compressed payloads that use a text
 * dictionary. The checksum lets `decompressHast` verify that the caller
 * supplied the same `textContent` that was used during compression.
 */
export const CHECKSUM_BYTES = 4;

/**
 * Shared dictionary for DEFLATE compression of HAST JSON.
 *
 * Contains byte sequences that frequently appear in JSON-serialized HAST trees
 * (syntax-highlighted TypeScript type documentation). The dictionary is
 * embedded in both the server build and the client bundle, so it must stay
 * small — currently ~3 KB uncompressed.
 */
export const HAST_DICTIONARY = strToU8(
  [
    // JSON structural patterns (most frequent first)
    '{"type":"element","tagName":"span","properties":{"className":["frame"],"dataFrameType":"',
    '{"type":"element","tagName":"span","properties":{"className":["line"],"dataLn":',
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
    '"dataFrameType":"comment"',
    '"dataFrameType":"property"',
    '"dataFrameIndent":',
    '"dataLn":',
    '"dataType":"TypeRef"',
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
    'React.useState',
    'React.useEffect',
    'React.useMemo',
    'React.useCallback',
    'React.useRef',
    'React.useContext',
    'React.useReducer',
    'React.JSX.Element',
    'JSX.Element',
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
    'ShadowRoot',
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
    '(state: ',
    '(props: HTMLProps, state: ',
    ', eventDetails: ',
    ': string',
    ': number',
    ': boolean',
    ': void',
    ') => string | undefined',
    ') => React.CSSProperties | undefined',
    ') => ReactElement',
    '(open: boolean) => void',
    '(): JSX.Element',
    '(): React.JSX.Element',
    'useMemo<',
    'useCallback<',
    'useReducer<',
    'React.useMemo<',
    'React.useCallback<',
    'React.useReducer<',
    'Dispatch<React.SetStateAction<',
    'React.MutableRefObject<',
    '[state, setState]',
    '[value, setValue]',
    '[open, setOpen]',
    '[count, setCount]',
    '<div',
    '</div>',
    '<button',
    '</button>',
    '/>',
    '=> <',
    '{children}',
    'className={',
    // Common prop names (from typeOrder)
    'className',
    'children',
    'disabled',
    'style',
    'render',
    'defaultValue',
    'value',
    'onClick',
    'onChange',
    'onSubmit',
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
    'aria-label',
    'aria-describedby',
    'aria-expanded',
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
    'AlertDialog.',
    'Autocomplete.',
    'NumberField.',
    'NavigationMenu.',
    'Accordion.',
    'Checkbox.',
    'Combobox.',
    'ContextMenu.',
    'Dialog.',
    'Popover.',
    'Radio.',
    'Select.',
    'Slider.',
    'Switch.',
    'Tabs.',
    'Toggle.',
    'Tooltip.',
    // Common React hook names
    'useState',
    'useEffect',
    'useMemo',
    'useCallback',
    'useRef',
    'useContext',
    'useReducer',
    // Common type suffixes
    'Props',
    '.State',
    '.ChangeEventDetails',
    'DataAttributes',
    'CssVars',
    // Common Base UI event and state tokens
    'BaseUIEvent',
    'TransitionStatus',
    'SeparatorState',
    'reason',
    'allowPropagation',
    'isCanceled',
    'isPropagationAllowed',
    'itemValue',
    'inline-start',
    'inline-end',
    'trigger-press',
    'outside-press',
    'focus-out',
    'list-navigation',
    'escape-key',
    'item-press',
    'close-press',
  ].join(''),
);

/**
 * FNV-1a 32-bit hash of a Uint8Array.
 *
 * Used to detect dictionary mismatches between compression and decompression.
 * This is NOT cryptographic — it catches programming errors (wrong
 * `textContent` passed), not adversarial tampering.
 *
 * Returns 4 bytes in big-endian order.
 */
export function computeDictionaryChecksum(dict: Uint8Array): Uint8Array {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < dict.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash ^= dict[i];
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }

  const out = new Uint8Array(CHECKSUM_BYTES);
  /* eslint-disable no-bitwise */
  out[0] = (hash >>> 24) & 0xff;
  out[1] = (hash >>> 16) & 0xff;
  out[2] = (hash >>> 8) & 0xff;
  out[3] = hash & 0xff;
  /* eslint-enable no-bitwise */
  return out;
}

/**
 * Build a DEFLATE dictionary by combining optional text content with the
 * static `HAST_DICTIONARY`.
 *
 * Layout: `[textContent bytes (truncated)][HAST_DICTIONARY]`
 *
 * - `HAST_DICTIONARY` is always at the **end** so it falls within DEFLATE's
 *   32 KiB window regardless of text length.
 * - `textContent` is truncated from the **end** (keeps the start, which
 *   corresponds to the first-rendered / most important content).
 *
 * When `textContent` is omitted or empty, returns `HAST_DICTIONARY` as-is.
 */
export function buildDictionary(textContent?: string): Uint8Array {
  if (!textContent) {
    return HAST_DICTIONARY;
  }

  const textBytes = strToU8(textContent);
  const maxTextBytes = MAX_DICTIONARY_SIZE - HAST_DICTIONARY.byteLength;

  if (maxTextBytes <= 0) {
    return HAST_DICTIONARY;
  }

  // Truncate text from the end — keep the start (first-rendered content)
  const usableText =
    textBytes.byteLength > maxTextBytes ? textBytes.slice(0, maxTextBytes) : textBytes;

  const combined = new Uint8Array(usableText.byteLength + HAST_DICTIONARY.byteLength);
  combined.set(usableText, 0);
  combined.set(HAST_DICTIONARY, usableText.byteLength);
  return combined;
}

/**
 * Error thrown when the dictionary checksum in a compressed payload does not
 * match the dictionary built from the provided `textContent`.
 */
export class HastDictionaryMismatchError extends Error {
  override name = 'HastDictionaryMismatchError';

  constructor() {
    super(
      'HAST dictionary mismatch: the textContent used for compression does not match ' +
        'the textContent provided for decompression. Ensure the same text is provided to both.',
    );
  }
}
