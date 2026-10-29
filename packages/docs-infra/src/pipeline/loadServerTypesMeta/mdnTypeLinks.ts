import type { ExternalTypeSource } from '@mui/internal-typescript-api-extractor';

/**
 * TypeScript lib files whose globals MDN documents: the DOM, JavaScript, and workers.
 */
const MDN_DOCUMENTED_LIBS = ['lib.dom', 'lib.es', 'lib.webworker'];

/**
 * Maps built-in types (e.g. `HTMLElement`, `Intl.NumberFormatOptions`) to their MDN page.
 *
 * Hand-picked: the types MUI libraries use in their public APIs, not every type MDN documents.
 * Add an entry here when a library's API starts using another built-in type.
 */
const MDN_TYPE_LINKS: Record<string, string> = {
  // DOM nodes
  Node: 'https://developer.mozilla.org/docs/Web/API/Node',
  Element: 'https://developer.mozilla.org/docs/Web/API/Element',
  HTMLElement: 'https://developer.mozilla.org/docs/Web/API/HTMLElement',
  SVGElement: 'https://developer.mozilla.org/docs/Web/API/SVGElement',
  Document: 'https://developer.mozilla.org/docs/Web/API/Document',
  DocumentFragment: 'https://developer.mozilla.org/docs/Web/API/DocumentFragment',
  ShadowRoot: 'https://developer.mozilla.org/docs/Web/API/ShadowRoot',
  Window: 'https://developer.mozilla.org/docs/Web/API/Window',
  EventTarget: 'https://developer.mozilla.org/docs/Web/API/EventTarget',
  Text: 'https://developer.mozilla.org/docs/Web/API/Text',
  // HTML elements
  HTMLAnchorElement: 'https://developer.mozilla.org/docs/Web/API/HTMLAnchorElement',
  HTMLButtonElement: 'https://developer.mozilla.org/docs/Web/API/HTMLButtonElement',
  HTMLCanvasElement: 'https://developer.mozilla.org/docs/Web/API/HTMLCanvasElement',
  HTMLDetailsElement: 'https://developer.mozilla.org/docs/Web/API/HTMLDetailsElement',
  HTMLDialogElement: 'https://developer.mozilla.org/docs/Web/API/HTMLDialogElement',
  HTMLDivElement: 'https://developer.mozilla.org/docs/Web/API/HTMLDivElement',
  HTMLFieldSetElement: 'https://developer.mozilla.org/docs/Web/API/HTMLFieldSetElement',
  HTMLFormElement: 'https://developer.mozilla.org/docs/Web/API/HTMLFormElement',
  HTMLHeadingElement: 'https://developer.mozilla.org/docs/Web/API/HTMLHeadingElement',
  HTMLIFrameElement: 'https://developer.mozilla.org/docs/Web/API/HTMLIFrameElement',
  HTMLImageElement: 'https://developer.mozilla.org/docs/Web/API/HTMLImageElement',
  HTMLInputElement: 'https://developer.mozilla.org/docs/Web/API/HTMLInputElement',
  HTMLLabelElement: 'https://developer.mozilla.org/docs/Web/API/HTMLLabelElement',
  HTMLLIElement: 'https://developer.mozilla.org/docs/Web/API/HTMLLIElement',
  HTMLOListElement: 'https://developer.mozilla.org/docs/Web/API/HTMLOListElement',
  HTMLOptionElement: 'https://developer.mozilla.org/docs/Web/API/HTMLOptionElement',
  HTMLOutputElement: 'https://developer.mozilla.org/docs/Web/API/HTMLOutputElement',
  HTMLParagraphElement: 'https://developer.mozilla.org/docs/Web/API/HTMLParagraphElement',
  HTMLSelectElement: 'https://developer.mozilla.org/docs/Web/API/HTMLSelectElement',
  HTMLSlotElement: 'https://developer.mozilla.org/docs/Web/API/HTMLSlotElement',
  HTMLSpanElement: 'https://developer.mozilla.org/docs/Web/API/HTMLSpanElement',
  HTMLTableCellElement: 'https://developer.mozilla.org/docs/Web/API/HTMLTableCellElement',
  HTMLTableElement: 'https://developer.mozilla.org/docs/Web/API/HTMLTableElement',
  HTMLTableRowElement: 'https://developer.mozilla.org/docs/Web/API/HTMLTableRowElement',
  HTMLTableSectionElement: 'https://developer.mozilla.org/docs/Web/API/HTMLTableSectionElement',
  HTMLTextAreaElement: 'https://developer.mozilla.org/docs/Web/API/HTMLTextAreaElement',
  HTMLUListElement: 'https://developer.mozilla.org/docs/Web/API/HTMLUListElement',
  HTMLVideoElement: 'https://developer.mozilla.org/docs/Web/API/HTMLVideoElement',
  // SVG elements
  SVGSVGElement: 'https://developer.mozilla.org/docs/Web/API/SVGSVGElement',
  SVGGElement: 'https://developer.mozilla.org/docs/Web/API/SVGGElement',
  SVGPathElement: 'https://developer.mozilla.org/docs/Web/API/SVGPathElement',
  SVGRectElement: 'https://developer.mozilla.org/docs/Web/API/SVGRectElement',
  SVGCircleElement: 'https://developer.mozilla.org/docs/Web/API/SVGCircleElement',
  SVGLineElement: 'https://developer.mozilla.org/docs/Web/API/SVGLineElement',
  SVGTextElement: 'https://developer.mozilla.org/docs/Web/API/SVGTextElement',
  SVGPatternElement: 'https://developer.mozilla.org/docs/Web/API/SVGPatternElement',
  SVGForeignObjectElement: 'https://developer.mozilla.org/docs/Web/API/SVGForeignObjectElement',
  // Events
  Event: 'https://developer.mozilla.org/docs/Web/API/Event',
  UIEvent: 'https://developer.mozilla.org/docs/Web/API/UIEvent',
  MouseEvent: 'https://developer.mozilla.org/docs/Web/API/MouseEvent',
  PointerEvent: 'https://developer.mozilla.org/docs/Web/API/PointerEvent',
  KeyboardEvent: 'https://developer.mozilla.org/docs/Web/API/KeyboardEvent',
  FocusEvent: 'https://developer.mozilla.org/docs/Web/API/FocusEvent',
  InputEvent: 'https://developer.mozilla.org/docs/Web/API/InputEvent',
  CompositionEvent: 'https://developer.mozilla.org/docs/Web/API/CompositionEvent',
  TouchEvent: 'https://developer.mozilla.org/docs/Web/API/TouchEvent',
  WheelEvent: 'https://developer.mozilla.org/docs/Web/API/WheelEvent',
  DragEvent: 'https://developer.mozilla.org/docs/Web/API/DragEvent',
  ClipboardEvent: 'https://developer.mozilla.org/docs/Web/API/ClipboardEvent',
  SubmitEvent: 'https://developer.mozilla.org/docs/Web/API/SubmitEvent',
  ToggleEvent: 'https://developer.mozilla.org/docs/Web/API/ToggleEvent',
  AnimationEvent: 'https://developer.mozilla.org/docs/Web/API/AnimationEvent',
  TransitionEvent: 'https://developer.mozilla.org/docs/Web/API/TransitionEvent',
  CustomEvent: 'https://developer.mozilla.org/docs/Web/API/CustomEvent',
  // Other web APIs
  AbortController: 'https://developer.mozilla.org/docs/Web/API/AbortController',
  AbortSignal: 'https://developer.mozilla.org/docs/Web/API/AbortSignal',
  CSSStyleDeclaration: 'https://developer.mozilla.org/docs/Web/API/CSSStyleDeclaration',
  DataTransfer: 'https://developer.mozilla.org/docs/Web/API/DataTransfer',
  DOMRect: 'https://developer.mozilla.org/docs/Web/API/DOMRect',
  DOMRectReadOnly: 'https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly',
  File: 'https://developer.mozilla.org/docs/Web/API/File',
  FileList: 'https://developer.mozilla.org/docs/Web/API/FileList',
  Blob: 'https://developer.mozilla.org/docs/Web/API/Blob',
  FormData: 'https://developer.mozilla.org/docs/Web/API/FormData',
  IntersectionObserver: 'https://developer.mozilla.org/docs/Web/API/IntersectionObserver',
  IntersectionObserverEntry: 'https://developer.mozilla.org/docs/Web/API/IntersectionObserverEntry',
  MediaQueryList: 'https://developer.mozilla.org/docs/Web/API/MediaQueryList',
  MutationObserver: 'https://developer.mozilla.org/docs/Web/API/MutationObserver',
  MutationRecord: 'https://developer.mozilla.org/docs/Web/API/MutationRecord',
  Range: 'https://developer.mozilla.org/docs/Web/API/Range',
  ResizeObserver: 'https://developer.mozilla.org/docs/Web/API/ResizeObserver',
  ResizeObserverEntry: 'https://developer.mozilla.org/docs/Web/API/ResizeObserverEntry',
  Selection: 'https://developer.mozilla.org/docs/Web/API/Selection',
  URL: 'https://developer.mozilla.org/docs/Web/API/URL',
  URLSearchParams: 'https://developer.mozilla.org/docs/Web/API/URLSearchParams',
  ValidityState: 'https://developer.mozilla.org/docs/Web/API/ValidityState',
  VisualViewport: 'https://developer.mozilla.org/docs/Web/API/VisualViewport',
  // JavaScript
  Array: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array',
  Date: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Date',
  Error: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error',
  Map: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Map',
  Set: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Set',
  WeakMap: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WeakMap',
  WeakSet: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WeakSet',
  WeakRef: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WeakRef',
  Promise: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise',
  RegExp: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/RegExp',
  'Intl.Collator':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator',
  'Intl.CollatorOptions':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator/Collator#options',
  'Intl.DateTimeFormat':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat',
  'Intl.DateTimeFormatOptions':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#options',
  'Intl.ListFormat':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/ListFormat',
  'Intl.Locale':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale',
  'Intl.LocalesArgument':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl#locales_argument',
  'Intl.NumberFormat':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat',
  'Intl.NumberFormatOptions':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat#options',
  'Intl.PluralRules':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules',
  'Intl.RelativeTimeFormat':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat',
  'Temporal.Duration':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Duration',
  'Temporal.Instant':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant',
  'Temporal.PlainDate':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate',
  'Temporal.PlainDateTime':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDateTime',
  'Temporal.PlainTime':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainTime',
  'Temporal.ZonedDateTime':
    'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Temporal/ZonedDateTime',
};

/**
 * Returns the MDN page for a type declared in one of the TypeScript lib files MDN documents,
 * or `undefined`. A package type with the same name as a built-in type is not linked.
 */
export function getMdnTypeLink(name: string, source: ExternalTypeSource): string | undefined {
  if (
    source.kind !== 'lib' ||
    !source.files.some((file) => MDN_DOCUMENTED_LIBS.some((lib) => file.startsWith(lib)))
  ) {
    return undefined;
  }
  return Object.hasOwn(MDN_TYPE_LINKS, name) ? MDN_TYPE_LINKS[name] : undefined;
}
