/**
 * Converts highlights tokens into HAST in the GitHub "prettylights" class
 * vocabulary (`pl-k`, `pl-s`, `pl-c1`, …) with the token shapes the rest of the
 * pipeline is built on: strings are `pl-s` spans with `pl-pds` quote delimiters,
 * JSX expression braces are `pl-pse`, unstyled punctuation stays in text nodes,
 * and `extendSyntaxTokens` layers `di-*` classes on top. Existing `pl-*` themes
 * therefore keep working.
 *
 * Pure data transformation: the engine itself lives in `./highlightToHast`.
 */
import type { Element, ElementContent, Root } from 'hast';
import type { Piece } from './splitHighlightTokens';
import { isWhitespace } from './splitHighlightTokens';

const QUOTES = new Set(['"', "'", '`']);

type Mode = 'js' | 'css' | 'json' | 'yaml' | 'sh' | 'html' | 'md' | 'diff';

export const SCOPE_MODES: Record<string, Mode> = {
  'source.js': 'js',
  'source.ts': 'js',
  'source.tsx': 'js',
  'source.json': 'json',
  'text.md': 'md',
  'source.mdx': 'md',
  'text.html.basic': 'html',
  'source.css': 'css',
  'source.shell': 'sh',
  'source.yaml': 'yaml',
  'source.diff': 'diff',
};

const FENCE_MODES: Record<string, Mode> = {
  js: 'js',
  jsx: 'js',
  javascript: 'js',
  ts: 'js',
  tsx: 'js',
  typescript: 'js',
  mjs: 'js',
  cjs: 'js',
  css: 'css',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'sh',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  html: 'html',
  diff: 'diff',
};

/** TypeScript primitive type keywords. */
const BUILT_IN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'void',
  'never',
  'symbol',
  'object',
  'any',
  'unknown',
  'bigint',
]);

/** Text that puts the following identifier in a type annotation. */
const TYPE_POSITION_TEXT = new Set([
  ':',
  '<',
  '|',
  '&',
  'extends',
  'implements',
  'keyof',
  'typeof',
  'as',
]);

/** Text after which a `{` continues a type expression when already in one. */
const TYPE_CONTINUATION_TEXT = new Set(['|', '&', '=>', '<', ',', '(', '[', ':', '?:']);

/** Token types that can name a type-literal member. */
const MEMBER_NAME_TYPES = new Set([
  'property',
  'variable',
  'variable-parameter',
  'function',
  'function-method',
  'type',
]);

type BraceKind = 'jsx' | 'type' | 'object';

/** Token types that can take type arguments: `useState<T>`, `Array<T>`, `fn<T>()`. */
const GENERIC_OWNER_TYPES = new Set([
  'type',
  'type-class',
  'type-builtin',
  'function',
  'function-method',
  'function-definition',
  'property',
  'variable',
  'constructor',
]);

const CLASS_MEMBER_MODIFIERS = new Set([
  'private',
  'public',
  'protected',
  'static',
  'readonly',
  'declare',
  'override',
  'accessor',
]);

/** A YAML block scalar header: `|`, `>`, optionally with chomping and indent indicators. */
function isBlockScalarIndicator(text: string): boolean {
  if (text[0] !== '|' && text[0] !== '>') {
    return false;
  }
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '-' && char !== '+' && !isDigit(char.charCodeAt(0))) {
      return false;
    }
  }
  return true;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function span(className: string, children: ElementContent[]): Element {
  return { type: 'element', tagName: 'span', properties: { className: [className] }, children };
}

function textSpan(className: string, value: string): Element {
  return span(className, [{ type: 'text', value }]);
}

function quoteLength(text: string, quote: string): number {
  let length = 0;
  while (length < text.length && text[length] === quote) {
    length += 1;
  }
  return length;
}

/** Splits a number-with-unit (`4px`, `100%`) into its numeric part and unit. */
function splitUnit(text: string): [string, string] {
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const numeric =
      (code >= 48 && code <= 57) ||
      code === 46 ||
      ((code === 45 || code === 43) && index === 0) ||
      ((code === 101 || code === 69) &&
        index > 0 &&
        isDigit(
          text.charCodeAt(index + 1) === 45
            ? text.charCodeAt(index + 2)
            : text.charCodeAt(index + 1),
        ));
    if (!numeric) {
      break;
    }
    index += 1;
  }
  return [text.slice(0, index), text.slice(index)];
}

interface StringFrame {
  quote: string;
  /** Open `${` interpolations inside this template literal. */
  exprDepth: number;
}

/**
 * Converts highlights tokens into HAST, one source line at a time, tracking the
 * context the class mapping needs (open strings, JSX expressions, generics,
 * `const` declarations, embedded languages).
 */
export class HastBuilder {
  private readonly root: ElementContent[] = [];

  /** The element children currently being appended to; strings nest a container. */
  private target: ElementContent[] = this.root;

  private stringStack: StringFrame[] = [];

  private braceKinds: BraceKind[] = [];

  /** Brace depth at which a `type X = …` alias started; `-1` outside one. */
  private typeAliasDepth = -1;

  /** Set by `interface`; the next `{` opens a type literal. */
  private interfacePending = false;

  /** Pieces the current token consumed beyond itself (e.g. a member's `?:`). */
  private consumed = 0;

  /** Class emitted for the current piece, and for the two significant pieces before it. */
  private currentClass: string | undefined;

  private previousClass: string | undefined;

  private beforePreviousClass: string | undefined;

  private genericDepth = 0;

  private inConstDeclaration = false;

  /** Inside `import … from`, where bindings render as plain identifiers. */
  private inImport = false;

  /** The significant piece before `previous`. */
  private beforePrevious: Piece | undefined;

  private previous: Piece | undefined;

  private lastBraceClosedJsx = false;

  private afterWhitespace = true;

  /** Whether the current piece directly follows the previous one, with no whitespace. */
  private adjacentToPrevious = false;

  declare private mode: Mode;

  declare private readonly baseMode: Mode;

  /** Embedded language for an HTML `<script>`/`<style>` once its tag closes. */
  private pendingMode: Mode | undefined;

  private lineWrapper: Element | undefined;

  private inFence = false;

  /**
   * The backticks of an inline code span whose contents the MDX lexer split
   * into tokens (it lexes `` `{ … }` `` as a JSX expression); empty otherwise.
   */
  private inlineCodeFence = '';

  /** Where a Markdown link's `](url)` container returns to once closed. */
  private linkTarget: ElementContent[] | undefined;

  constructor(mode: Mode) {
    this.mode = mode;
    this.baseMode = mode;
  }

  build(lines: Piece[][], terminators: string[]): Root {
    lines.forEach((pieces, lineIndex) => {
      this.startLine();
      for (let index = 0; index < pieces.length; index += 1) {
        this.add(pieces, index);
        index += this.consumed;
        this.consumed = 0;
      }
      this.endLine();
      if (terminators[lineIndex]) {
        this.root.push({ type: 'text', value: terminators[lineIndex] });
      }
    });
    return { type: 'root', children: mergeText(this.root) };
  }

  private startLine(): void {
    this.target = this.root;
    if (this.stringStack.length > 0) {
      this.openStringContainer();
    }
  }

  private endLine(): void {
    this.target = this.root;
    this.lineWrapper = undefined;
    this.linkTarget = undefined;
    this.inlineCodeFence = '';
    this.inConstDeclaration = false;
  }

  private openStringContainer(): void {
    const container = span('pl-s', []);
    this.target.push(container);
    this.target = container.children;
  }

  private closeStringContainer(): void {
    this.target = this.lineWrapper ? this.lineWrapper.children : this.root;
  }

  private text(value: string): void {
    this.target.push({ type: 'text', value });
  }

  private nextSignificant(pieces: Piece[], index: number): Piece | undefined {
    for (let next = index + 1; next < pieces.length; next += 1) {
      if (pieces[next].type !== '') {
        return pieces[next];
      }
      if (pieces[next].text.trim() !== '') {
        return pieces[next];
      }
    }
    return undefined;
  }

  private add(pieces: Piece[], index: number): void {
    const piece = pieces[index];
    const { type, text } = piece;
    if (this.inlineCodeFence) {
      this.addInsideInlineCode(text);
      return;
    }
    if (type === '') {
      this.text(text);
      this.afterWhitespace = text.trim() === '';
      return;
    }
    const adjacent = !this.afterWhitespace;
    this.afterWhitespace = false;
    this.adjacentToPrevious = adjacent;
    if (this.lineWrapper) {
      this.text(text);
      this.previous = piece;
      return;
    }

    const frame = this.stringStack[this.stringStack.length - 1];
    if (frame && frame.exprDepth === 0) {
      this.addInsideString(piece, frame);
      this.previous = piece;
      return;
    }

    this.currentClass = undefined;
    this.addToken(pieces, index);
    this.beforePrevious = this.previous;
    this.previous = this.consumed > 0 ? pieces[index + this.consumed] : piece;
    this.beforePreviousClass = this.previousClass;
    this.previousClass = this.currentClass;
  }

  /** Content of an open multi-token string (template literal, shell double quotes). */
  private addInsideString(piece: Piece, frame: StringFrame): void {
    const { type, text } = piece;
    if (type === 'string') {
      if (text.endsWith(frame.quote)) {
        const closing = frame.quote.length;
        const body = text.slice(0, text.length - closing);
        if (body) {
          this.text(body);
        }
        this.target.push(textSpan('pl-pds', text.slice(text.length - closing)));
        this.stringStack.pop();
        this.closeStringContainer();
      } else {
        this.text(text);
      }
      return;
    }
    if (type === 'punctuation-special' && text === '${') {
      this.text(text);
      frame.exprDepth += 1;
      return;
    }
    if (type === 'string-escape') {
      this.target.push(textSpan('pl-cce', text));
      return;
    }
    if (type.startsWith('variable')) {
      this.target.push(textSpan('pl-smi', text));
      return;
    }
    this.text(text);
  }

  private addString(text: string): void {
    // `import './side-effect.css'` and `from '…'` end the import clause.
    this.inImport = false;
    const quote = text[0];
    const quoted = QUOTES.has(quote);
    // Only JS and shell strings span several tokens (interpolations, escapes);
    // elsewhere an unterminated quote, e.g. in a YAML block scalar, is plain text.
    const canOpenRun = this.mode === 'js' || this.mode === 'sh';
    if (!quoted || (!canOpenRun && (text.length < 2 || !text.endsWith(quote)))) {
      this.target.push(textSpan('pl-s', text));
      return;
    }
    // Quotes are single characters; `''` is an opening and a closing quote.
    const opening = 1;
    const rest = text.slice(opening);
    const closing = rest.endsWith(quote) && !rest.endsWith(`\\${quote}`) ? 1 : 0;
    const complete = closing > 0;
    const container = span('pl-s', [textSpan('pl-pds', text.slice(0, opening))]);
    this.target.push(container);
    if (complete) {
      const body = rest.slice(0, rest.length - closing);
      if (body) {
        container.children.push({ type: 'text', value: body });
      }
      container.children.push(textSpan('pl-pds', rest.slice(rest.length - closing)));
      return;
    }
    if (rest) {
      container.children.push({ type: 'text', value: rest });
    }
    this.stringStack.push({ quote: text.slice(0, opening), exprDepth: 0 });
    this.target = container.children;
  }

  private addRegex(text: string): void {
    const close = text.lastIndexOf('/');
    if (!text.startsWith('/') || close <= 0) {
      this.target.push(span('pl-s', [textSpan('pl-sr', text)]));
      return;
    }
    const children: ElementContent[] = [textSpan('pl-pds', '/')];
    if (close > 1) {
      children.push({ type: 'text', value: text.slice(1, close) });
    }
    children.push(textSpan('pl-pds', '/'));
    if (close + 1 < text.length) {
      children.push(textSpan('pl-k', text.slice(close + 1)));
    }
    this.target.push(span('pl-s', [span('pl-sr', children)]));
  }

  private addToken(pieces: Piece[], index: number): void {
    const { type, text } = pieces[index];

    if (
      this.baseMode === 'md' &&
      type === 'punctuation-delimiter' &&
      (text.startsWith('```') || text.startsWith('~~~'))
    ) {
      this.addFence(text);
      return;
    }

    if (type === 'string') {
      if (this.mode === 'json' && this.isJsonKey(pieces, index)) {
        this.target.push(textSpan('pl-ent', text));
        return;
      }
      this.addString(text);
      return;
    }
    if (type === 'string-regex') {
      this.addRegex(text);
      return;
    }

    const frame = this.stringStack[this.stringStack.length - 1];
    if (frame && type === 'punctuation-special' && text === '}') {
      frame.exprDepth -= 1;
      this.text(text);
      return;
    }

    switch (this.mode) {
      case 'css':
        this.addCssToken(pieces, index);
        return;
      case 'md':
        if (this.addMarkdownToken(pieces, index)) {
          return;
        }
        break;
      case 'html':
        if (this.addHtmlToken(pieces, index)) {
          return;
        }
        break;
      default:
        break;
    }
    this.addCodeToken(pieces, index);
  }

  private isJsonKey(pieces: Piece[], index: number): boolean {
    return this.nextSignificant(pieces, index)?.text.startsWith(':') ?? false;
  }

  private push(className: string | undefined, text: string): void {
    this.currentClass = className;
    if (className) {
      this.target.push(textSpan(className, text));
    } else {
      this.text(text);
    }
  }

  private addCssToken(pieces: Piece[], index: number): void {
    const { type, text } = pieces[index];
    if (type === 'number') {
      const [value, unit] = splitUnit(text);
      if (value) {
        this.push('pl-c1', value);
      }
      if (unit) {
        this.push('pl-k', unit);
      }
      return;
    }
    if (type === 'operator') {
      this.push(text === '&' ? undefined : 'pl-k', text);
      return;
    }
    if (type.startsWith('selector') || type === 'attribute') {
      // `.b:hover` lexes as two selectors; keep compound selectors in one span.
      const last = this.target[this.target.length - 1];
      if (
        this.previous?.type.startsWith('selector') &&
        last?.type === 'element' &&
        last.properties.className?.toString() === 'pl-e' &&
        last.children[0]?.type === 'text'
      ) {
        last.children[0].value += text;
        return;
      }
      this.push('pl-e', text);
      return;
    }
    if (type === 'tag') {
      this.push('pl-ent', text);
      return;
    }
    if (type === 'variable') {
      this.push('pl-v', text);
      return;
    }
    if (
      type === 'property' ||
      type === 'function' ||
      type.startsWith('constant') ||
      type === 'string-special'
    ) {
      this.push('pl-c1', text);
      return;
    }
    this.addCodeToken(pieces, index);
  }

  private addHtmlToken(pieces: Piece[], index: number): boolean {
    const { type, text } = pieces[index];
    if (type === 'tag') {
      const opener = this.previous?.text.endsWith('<') ?? false;
      if (opener && (text === 'script' || text === 'style')) {
        this.pendingMode = text === 'script' ? 'js' : 'css';
      }
      this.push('pl-ent', text);
      return true;
    }
    if (type === 'punctuation-bracket-html') {
      if (text.startsWith('</')) {
        this.mode = 'html';
      }
      if (text.endsWith('>') && this.pendingMode) {
        this.mode = this.pendingMode;
        this.pendingMode = undefined;
      }
      this.text(text);
      return true;
    }
    if (type === 'attribute') {
      this.push('pl-e', text);
      return true;
    }
    if (type === 'punctuation-delimiter-html' || type === 'tag-doctype') {
      this.text(text);
      return true;
    }
    if (type === 'string-special' && text.startsWith('&') && text.endsWith(';')) {
      this.push('pl-c1', '&');
      this.push('pl-en', text.slice(1, -1));
      this.push('pl-c1', ';');
      return true;
    }
    return false;
  }

  private addMarkdownToken(pieces: Piece[], index: number): boolean {
    const { type, text } = pieces[index];
    switch (type) {
      case 'title': {
        let marks = 0;
        while (marks < text.length && text[marks] === '#') {
          marks += 1;
        }
        let gap = marks;
        while (gap < text.length && isWhitespace(text.charCodeAt(gap))) {
          gap += 1;
        }
        const children: ElementContent[] = [{ type: 'text', value: text.slice(0, gap) }];
        if (gap < text.length) {
          children.push(textSpan('pl-en', text.slice(gap)));
        }
        this.target.push(span('pl-mh', children));
        return true;
      }
      case 'emphasis':
      case 'emphasis-strong': {
        const marker = text[0];
        const length = quoteLength(text, marker);
        if (length > 0 && length * 2 < text.length) {
          this.push('pl-s', text.slice(0, length));
          this.text(text.slice(length, text.length - length));
          this.push('pl-s', text.slice(text.length - length));
        } else {
          this.text(text);
        }
        return true;
      }
      case 'text-literal':
        this.addInlineCode(text);
        return true;
      case 'punctuation-bracket':
        if (text === '[') {
          this.push('pl-s', text);
          return true;
        }
        if (text === ']' && this.nextSignificant(pieces, index)?.text === '(') {
          this.linkTarget = this.target;
          const container = textSpan('pl-s', text);
          this.target.push(container);
          this.target = container.children;
          return true;
        }
        if (text === ')' && this.linkTarget) {
          this.text(text);
          this.target = this.linkTarget;
          this.linkTarget = undefined;
          return true;
        }
        if (text === ']' || text === '(' || text === ')') {
          this.text(text);
          return true;
        }
        return false;
      case 'link-uri':
        this.push('pl-corl', text);
        return true;
      case 'link-text':
        if (text.startsWith('`')) {
          this.addInlineCode(text);
        } else {
          this.text(text);
        }
        return true;
      case 'punctuation-list-marker': {
        const marker = text.trim();
        if (marker.endsWith('.') || marker.endsWith(')')) {
          this.push('pl-s', marker.slice(0, -1));
          this.push('pl-v', marker.slice(-1));
        } else {
          this.push('pl-v', marker);
        }
        return true;
      }
      case 'punctuation-markup':
        if (text.startsWith('>')) {
          this.lineWrapper = textSpan('pl-ent', text);
          this.target.push(this.lineWrapper);
          this.target = this.lineWrapper.children;
        } else {
          this.push(text === '|' ? 'pl-ml' : 'pl-s', text);
        }
        return true;
      case 'string-escape':
        this.push('pl-c1', text);
        return true;
      default:
        return false;
    }
  }

  /** A Markdown code fence: the opener switches to the fenced language, the closer back. */
  private addFence(text: string): void {
    const fence = quoteLength(text, text[0]);
    this.push('pl-s', text.slice(0, fence));
    const info = text.slice(fence);
    if (this.inFence) {
      this.inFence = false;
      this.mode = 'md';
      if (info) {
        this.text(info);
      }
      return;
    }
    this.inFence = true;
    const language = info.trim().split(/\s/)[0];
    if (language) {
      this.push('pl-en', info);
    }
    // Unknown languages stay in Markdown mode, where raw fence lines are `pl-c1`.
    this.mode = FENCE_MODES[language] ?? 'md';
  }

  /** `const name = (…) =>` or `const name = async (…) =>` on the same line. */
  private assignsArrowFunction(pieces: Piece[], index: number): boolean {
    let cursor = index + 1;
    while (cursor < pieces.length && pieces[cursor].type === '') {
      cursor += 1;
    }
    if (pieces[cursor]?.text !== '=') {
      return false;
    }
    const rest = pieces.slice(cursor + 1).filter((piece) => piece.type !== '');
    const start = rest[0]?.text === 'async' ? 1 : 0;
    if (rest[start]?.text !== '(' && rest[start + 1]?.text !== '=>') {
      return false;
    }
    return rest.some((piece) => piece.text === '=>');
  }

  private openingBraceKind(): BraceKind {
    if (this.isJsxContext()) {
      return 'jsx';
    }
    const previousText = this.previous?.text;
    if (this.interfacePending) {
      return 'type';
    }
    if (previousText === '=' && this.typeAliasDepth === this.braceKinds.length) {
      return 'type';
    }
    if ((previousText === ':' || previousText === '?:') && this.previousClass === 'pl-k') {
      return 'type';
    }
    if (
      previousText !== undefined &&
      TYPE_CONTINUATION_TEXT.has(previousText) &&
      (this.inTypeLiteral() || this.genericDepth > 0 || this.typeAliasDepth >= 0)
    ) {
      return 'type';
    }
    return 'object';
  }

  private inTypeLiteral(): boolean {
    return this.braceKinds[this.braceKinds.length - 1] === 'type';
  }

  /** Whether an identifier here names a type rather than a value. */
  private inTypePosition(): boolean {
    return (
      this.genericDepth > 0 ||
      (this.previousClass === 'pl-k' &&
        this.previous !== undefined &&
        TYPE_POSITION_TEXT.has(this.previous.text)) ||
      (this.typeAliasDepth >= 0 && this.previous?.text === '=')
    );
  }

  /**
   * A type-literal member name followed by `:`, `?:` or `?` `:`. Emits the name
   * (`pl-en` for function-typed members, `pl-v` otherwise) and one `pl-k` for
   * the colon, consuming the colon pieces. Returns whether it applied.
   */
  private addTypeMember(pieces: Piece[], index: number): boolean {
    let cursor = index + 1;
    let colon = '';
    while (
      cursor < pieces.length &&
      (pieces[cursor].text === '?' || pieces[cursor].text === ':' || pieces[cursor].text === '?:')
    ) {
      colon += pieces[cursor].text;
      cursor += 1;
      if (colon.endsWith(':')) {
        break;
      }
    }
    if (!colon.endsWith(':')) {
      return false;
    }
    const next = this.nextSignificant(pieces, cursor - 1);
    this.push(next?.text === '(' ? 'pl-en' : 'pl-v', pieces[index].text);
    this.push('pl-k', colon);
    this.consumed = cursor - 1 - index;
    return true;
  }

  private addInsideInlineCode(text: string): void {
    const close = text.indexOf(this.inlineCodeFence);
    const code = close === -1 ? text : text.slice(0, close);
    const last = this.target[this.target.length - 1];
    if (code && last?.type === 'element' && last.properties.className?.toString() === 'pl-c1') {
      const textNode = last.children[0];
      if (textNode?.type === 'text') {
        textNode.value += code;
      }
    } else if (code) {
      this.push('pl-c1', code);
    }
    if (close === -1) {
      return;
    }
    this.push('pl-s', this.inlineCodeFence);
    const rest = text.slice(close + this.inlineCodeFence.length);
    this.inlineCodeFence = '';
    if (rest) {
      this.addMarkdownProse(rest);
    }
  }

  /** Prose that may open further inline code spans, the last possibly left open. */
  private addMarkdownProse(text: string): void {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf('`', index);
      if (open === -1) {
        this.text(text.slice(index));
        return;
      }
      if (open > index) {
        this.text(text.slice(index, open));
      }
      const fence = '`'.repeat(quoteLength(text.slice(open), '`'));
      const close = text.indexOf(fence, open + fence.length);
      if (close === -1) {
        this.push('pl-s', fence);
        this.inlineCodeFence = fence;
        const code = text.slice(open + fence.length);
        if (code) {
          this.push('pl-c1', code);
        }
        return;
      }
      this.push('pl-s', fence);
      this.push('pl-c1', text.slice(open + fence.length, close));
      this.push('pl-s', fence);
      index = close + fence.length;
    }
  }

  /** Inline code (`` `code` ``), or a raw line of a fence with no known language. */
  private addInlineCode(text: string): void {
    const length = quoteLength(text, '`');
    if (length > 0 && length === text.length && !this.inFence) {
      this.push('pl-s', text);
      this.inlineCodeFence = text;
      return;
    }
    if (length > 0 && length * 2 < text.length && text.endsWith('`'.repeat(length))) {
      this.push('pl-s', text.slice(0, length));
      this.push('pl-c1', text.slice(length, text.length - length));
      this.push('pl-s', text.slice(text.length - length));
    } else {
      this.push('pl-c1', text);
    }
  }

  private isJsxContext(): boolean {
    return (
      this.lastBraceClosedJsx ||
      (this.previous !== undefined &&
        (this.previous.type.endsWith('-jsx') ||
          this.previous.type === 'tag-component-jsx' ||
          this.previous.type === 'text-jsx'))
    );
  }

  /** JS-family and shared mapping; the fallback for every other mode. */
  private addCodeToken(pieces: Piece[], index: number): void {
    const { type, text } = pieces[index];
    const previous = this.previous;

    if (this.mode === 'yaml' && isBlockScalarIndicator(text) && previous?.text === ':') {
      this.push('pl-s', text);
      return;
    }

    if (type === 'punctuation-bracket') {
      if (text === '{') {
        const kind = this.openingBraceKind();
        this.braceKinds.push(kind);
        this.interfacePending = false;
        this.lastBraceClosedJsx = false;
        this.push(kind === 'jsx' ? 'pl-pse' : undefined, text);
        return;
      }
      if (text === '}') {
        const kind = this.braceKinds.pop();
        this.lastBraceClosedJsx = kind === 'jsx';
        this.push(kind === 'jsx' ? 'pl-pse' : undefined, text);
        return;
      }
      this.lastBraceClosedJsx = false;
      this.text(text);
      return;
    }
    this.lastBraceClosedJsx = false;

    if (type === 'operator') {
      if (
        text === '<' &&
        this.adjacentToPrevious &&
        previous !== undefined &&
        GENERIC_OWNER_TYPES.has(previous.type)
      ) {
        this.genericDepth += 1;
        this.text(text);
        return;
      }
      if (text === '>' && this.genericDepth > 0) {
        this.genericDepth -= 1;
        this.text(text);
        return;
      }
      if (text === '*' && this.inImport) {
        this.push('pl-c1', text);
        return;
      }
      if (text === '=' && this.inConstDeclaration) {
        this.inConstDeclaration = false;
      }
      this.push('pl-k', text);
      return;
    }

    if (this.inConstDeclaration && (type === 'variable' || type.startsWith('function'))) {
      this.push(this.assignsArrowFunction(pieces, index) ? 'pl-en' : 'pl-c1', text);
      return;
    }
    if (type === 'keyword-declaration') {
      this.inConstDeclaration = text === 'const';
      if (text === 'type') {
        this.typeAliasDepth = this.braceKinds.length;
      } else if (text === 'interface') {
        this.interfacePending = true;
      }
      this.push('pl-k', text);
      return;
    }
    if (type.startsWith('keyword')) {
      if (text === 'void' && (previous?.text === ':' || previous?.text === '=>')) {
        this.push('pl-c1', text);
        return;
      }
      if (text === 'of' || text === 'in') {
        this.inConstDeclaration = false;
      }
      if (type === 'keyword-import') {
        this.inImport = text === 'import';
        if (text === 'from') {
          this.inImport = false;
        }
      }
      this.push('pl-k', text);
      return;
    }
    if (this.inTypeLiteral() && MEMBER_NAME_TYPES.has(type) && this.addTypeMember(pieces, index)) {
      return;
    }
    if (
      BUILT_IN_TYPES.has(text) &&
      (type === 'variable' || type === 'property' || type === 'type') &&
      (this.inTypePosition() || this.inTypeLiteral())
    ) {
      this.push('pl-c1', text);
      return;
    }
    if (this.inTypeLiteral() && (text === ':' || text === '?:') && type.startsWith('punctuation')) {
      this.push('pl-k', text);
      return;
    }
    if (this.inImport && (type === 'type' || type === 'variable' || type === 'constant')) {
      const next = this.nextSignificant(pieces, index);
      const isTypeModifier =
        text === 'type' && next !== undefined && next.type !== 'punctuation-delimiter';
      this.push(isTypeModifier ? 'pl-k' : 'pl-smi', text);
      return;
    }

    switch (type) {
      case 'comment':
      case 'comment-doc':
      case 'type-jsdoc':
        this.push('pl-c', text);
        return;
      case 'variable-jsdoc':
        this.push('pl-smi', text);
        return;
      case 'punctuation-special':
        this.push(text.includes(':') || text === '?' ? 'pl-k' : undefined, text);
        return;
      case 'punctuation-delimiter-jsx':
        this.push('pl-k', text);
        return;
      case 'tag-jsx':
      case 'tag':
        this.push('pl-ent', text);
        return;
      case 'tag-component-jsx':
        this.push('pl-c1', text);
        return;
      case 'attribute-jsx':
        this.push('pl-e', text);
        return;
      case 'string-escape':
        this.push('pl-cce', text);
        return;
      case 'string-special':
        this.push('pl-c1', text);
        return;
      case 'number':
        this.push(this.mode === 'sh' ? undefined : 'pl-c1', text);
        return;
      case 'boolean':
      case 'constant':
      case 'constant-builtin':
      case 'enum':
      case 'type-builtin':
      case 'variable-special':
        this.push('pl-c1', text);
        return;
      case 'type-class':
        this.push(
          previous?.text === 'extends' || previous?.text === 'implements' ? 'pl-e' : 'pl-en',
          text,
        );
        return;
      case 'function':
        this.push(this.mode === 'sh' ? 'pl-c1' : 'pl-en', text);
        return;
      case 'function-definition':
      case 'function-method':
      case 'constructor':
      case 'type':
      case 'namespace': {
        if (this.mode === 'yaml') {
          this.push('pl-s', text);
          return;
        }
        const next = this.nextSignificant(pieces, index);
        if (type === 'type' && this.previous === undefined && next === undefined) {
          this.push('pl-smi', text);
          return;
        }
        this.push(next?.text === '.' && !this.inTypePosition() ? 'pl-smi' : 'pl-en', text);
        return;
      }
      case 'variable-parameter':
        this.push(this.mode === 'sh' ? undefined : 'pl-v', text);
        return;
      case 'variable':
        if (this.mode === 'sh') {
          this.push(text.startsWith('$') ? 'pl-smi' : undefined, text);
          return;
        }
        if (this.genericDepth > 0 && BUILT_IN_TYPES.has(text)) {
          this.push('pl-c1', text);
        } else if (this.inConstDeclaration) {
          this.push('pl-c1', text);
        } else if (previous && CLASS_MEMBER_MODIFIERS.has(previous.text)) {
          this.push('pl-v', text);
        } else {
          this.push('pl-smi', text);
        }
        return;
      case 'property': {
        if (text === 'meta' && previous?.text === '.' && this.beforePrevious?.text === 'import') {
          this.push('pl-c1', text);
          return;
        }
        if (this.mode === 'yaml') {
          this.push('pl-ent', text);
          return;
        }
        const next = this.nextSignificant(pieces, index);
        const memberOfType = previous?.text === '.' && this.beforePreviousClass === 'pl-en';
        if (next?.text.startsWith('(') || (next?.text === '<' && next.type === 'operator')) {
          this.push('pl-en', text);
        } else if (memberOfType) {
          this.push('pl-en', text);
        } else if (
          next?.type === 'punctuation-special' &&
          (next.text === ':' || next.text === '?:')
        ) {
          // A member of a type literal or interface.
          this.push('pl-v', text);
        } else if (next?.text.startsWith(':')) {
          // An object-literal key; `extendSyntaxTokens` classifies it from the text.
          this.text(text);
        } else {
          this.push('pl-smi', text);
        }
        return;
      }
      case 'property-json-key':
        this.push('pl-ent', text);
        return;
      case 'punctuation-delimiter': {
        if (text === ';' && this.typeAliasDepth === this.braceKinds.length) {
          this.typeAliasDepth = -1;
        }
        if (text === ';') {
          this.inImport = false;
        }
        // A method's return-type colon lexes as a plain delimiter.
        const next = this.nextSignificant(pieces, index);
        const returnType =
          text === ':' &&
          previous?.text === ')' &&
          next !== undefined &&
          (next.type.startsWith('type') || next.text === 'void');
        const objectKey =
          previous?.type === 'property' ||
          (previous?.type === 'string' &&
            this.braceKinds[this.braceKinds.length - 1] === 'object') ||
          previous?.text === ']';
        this.push(
          returnType || (text === ':' && this.mode === 'js' && !objectKey) ? 'pl-k' : undefined,
          text,
        );
        return;
      }
      default:
        this.text(text);
    }
  }
}

/**
 * Diff lines are classified by their prefix alone, so they are built from the
 * line text rather than from tokens.
 */
export function diffLine(line: string): ElementContent[] {
  if (line.startsWith('@@')) {
    const close = line.indexOf('@@', 2);
    if (close !== -1) {
      const hunk = line.slice(0, close + 2);
      const rest = line.slice(close + 2);
      return rest
        ? [textSpan('pl-mdr', hunk), { type: 'text', value: rest }]
        : [textSpan('pl-mdr', hunk)];
    }
    return [textSpan('pl-mdr', line)];
  }
  if (line.startsWith('+')) {
    return [textSpan('pl-mi1', line)];
  }
  if (line.startsWith('-')) {
    return [textSpan('pl-md', line)];
  }
  if (line.startsWith('diff ')) {
    return [textSpan('pl-c1', line)];
  }
  return line ? [{ type: 'text', value: line }] : [];
}

/** Joins adjacent text nodes, recursively, so text-context checks see whole runs. */
export function mergeText(children: ElementContent[]): ElementContent[] {
  const merged: ElementContent[] = [];
  for (const child of children) {
    const last = merged[merged.length - 1];
    if (child.type === 'text' && last?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', value: last.value + child.value };
    } else if (child.type === 'text' && child.value === '') {
      continue;
    } else {
      if (child.type === 'element') {
        child.children = mergeText(child.children);
      }
      merged.push(child);
    }
  }
  return merged;
}
