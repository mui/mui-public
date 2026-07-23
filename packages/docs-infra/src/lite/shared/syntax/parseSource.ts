import type { Element, ElementContent, Root } from 'hast';
import {
  BUILT_IN_TYPES,
  LANGUAGES,
  findJsxGenericTypeArgRanges,
  highlightAsTypeArg,
  jsHighlighter,
  languageFromFileName,
  spliceTokens,
  tokenize,
} from './highlight';
import type { Token } from './highlight';
import {
  emptyEmphasis,
  extractEmphasis,
  resolveTextHighlightRanges,
  splitTokensAtRanges,
} from './emphasis';
import type { FocusRange } from './emphasis';

export interface ParseSourceData {
  totalLines: number;
  focusRange: FocusRange | null;
}

export interface ParseSourceRoot extends Root {
  data: ParseSourceData;
}

function toLinedHast(tokens: Token[], options: { highlightedLines?: Set<number> } = {}): Root {
  const highlightedLines = options.highlightedLines ?? new Set<number>();
  const lines: ElementContent[] = [];
  let currentLine: ElementContent[] = [];
  let markGroup: ElementContent[] | null = null;
  let lineNumber = 0;

  const flushMark = () => {
    if (!markGroup) {
      return;
    }
    const properties = highlightedLines.has(lineNumber + 1) ? { dataHl: '' } : {};
    if (
      markGroup.length === 1 &&
      markGroup[0].type === 'element' &&
      markGroup[0].tagName === 'span'
    ) {
      const [child] = markGroup;
      currentLine.push({
        ...child,
        tagName: 'mark',
        properties: { ...child.properties, ...properties },
      });
    } else {
      currentLine.push({ type: 'element', tagName: 'mark', properties, children: markGroup });
    }
    markGroup = null;
  };

  const pushLine = (endOfLine: boolean) => {
    flushMark();
    lineNumber += 1;
    const newlineInside = endOfLine && currentLine.length === 0;
    if (newlineInside) {
      currentLine.push({ type: 'text', value: '\n' });
    }
    const properties: Element['properties'] = { className: ['line'], dataLn: lineNumber };
    if (highlightedLines.has(lineNumber)) {
      properties.dataHl = '';
    }
    lines.push({ type: 'element', tagName: 'span', properties, children: currentLine });
    if (endOfLine && !newlineInside) {
      lines.push({ type: 'text', value: '\n' });
    }
    currentLine = [];
  };

  for (const token of tokens) {
    const parts = token.text.split('\n');
    // eslint-disable-next-line @typescript-eslint/no-loop-func
    parts.forEach((part, index) => {
      if (index > 0) {
        pushLine(true);
      }
      if (part === '') {
        return;
      }
      const node: ElementContent =
        token.classes === ''
          ? { type: 'text', value: part }
          : {
              type: 'element',
              tagName: 'span',
              properties: { className: token.classes.split(' ') },
              children: [{ type: 'text', value: part }],
            };
      if (token.mark) {
        markGroup = markGroup ? [...markGroup, node] : [node];
      } else {
        flushMark();
        currentLine.push(node);
      }
    });
  }
  flushMark();
  if (currentLine.length > 0) {
    pushLine(false);
  }

  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'], dataLined: '' },
        children: lines,
      },
    ],
  };
}

function spanNode(classes: string, text: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: classes.split(' ') },
    children: [{ type: 'text', value: text }],
  };
}

function tokenToNode(token: Token): ElementContent {
  return token.classes === ''
    ? { type: 'text', value: token.text }
    : spanNode(token.classes, token.text);
}

function groupInlineTags(tokens: Token[]): ElementContent[] {
  const nodes: ElementContent[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const opensTag =
      token.text.endsWith('<') && next && /(?:^| )(?:di-jt|di-ht|pl-ent)(?: |$)/.test(next.classes);
    if (!opensTag) {
      nodes.push(tokenToNode(token));
      index += 1;
      continue;
    }
    let close = index + 1;
    while (close < tokens.length && !tokens[close].text.includes('>')) {
      close += 1;
    }
    if (close === tokens.length) {
      nodes.push(tokenToNode(token));
      index += 1;
      continue;
    }
    const children: ElementContent[] = [];
    const prefix = token.text.slice(0, -1);
    if (prefix) {
      nodes.push(tokenToNode({ classes: token.classes, text: prefix }));
    }
    children.push(tokenToNode({ classes: token.classes, text: '<' }));
    for (let childIndex = index + 1; childIndex < close; childIndex += 1) {
      children.push(tokenToNode(tokens[childIndex]));
    }
    const closeText = tokens[close].text;
    const bracketEnd = closeText.indexOf('>') + 1;
    children.push(
      tokenToNode({ classes: tokens[close].classes, text: closeText.slice(0, bracketEnd) }),
    );
    nodes.push({
      type: 'element',
      tagName: 'span',
      properties: { className: [next.classes.includes('di-jt') ? 'di-jt' : 'di-ht'] },
      children,
    });
    const rest = closeText.slice(bracketEnd);
    if (rest) {
      tokens[close] = { classes: tokens[close].classes, text: rest };
      index = close;
    } else {
      index = close + 1;
    }
  }
  return nodes;
}

/** Highlights an inline snippet into flat hast children. */
export function parseSourceInline(source: string, language?: string): ElementContent[] | null {
  const lang = LANGUAGES[language ?? ''];
  if (!lang) {
    return null;
  }
  let text = source;
  let parenWrapped = false;
  if (lang.highlighter === jsHighlighter) {
    const trimmed = text.trim();
    if (BUILT_IN_TYPES.has(trimmed)) {
      return [spanNode('pl-c1 di-bt', text)];
    }
    if (trimmed.length >= 2 && trimmed.startsWith('{') && trimmed.endsWith('}')) {
      text = `(${text})`;
      parenWrapped = true;
    }
  }
  const tokens = tokenize(text, lang);
  if (parenWrapped && tokens.length > 0) {
    tokens[0].text = tokens[0].text.slice(1);
    tokens[tokens.length - 1].text = tokens[tokens.length - 1].text.slice(0, -1);
  }
  return groupInlineTags(tokens.filter((token) => token.text !== ''));
}

export interface ParseSourceOptions {
  /** Whether to parse and strip emphasis directive comments. */
  emphasis?: boolean;
}

/** Highlights source into the docs lined-frame hast structure. */
export function parseSource(
  source: string,
  fileName?: string,
  language?: string,
  options: ParseSourceOptions = {},
): ParseSourceRoot {
  const lang = LANGUAGES[language ?? ''] ?? LANGUAGES[languageFromFileName(fileName) ?? ''];
  const emphasis =
    lang && (options.emphasis ?? true) ? extractEmphasis(source, lang) : emptyEmphasis(source);
  const jsxGenericRanges = lang ? findJsxGenericTypeArgRanges(emphasis.source, lang) : [];
  const maskedSource = jsxGenericRanges.reduceRight(
    (result, range) =>
      result.slice(0, range.from) + ' '.repeat(range.to - range.from) + result.slice(range.to),
    emphasis.source,
  );

  let tokens: Token[] = lang ? tokenize(maskedSource, lang) : [{ text: maskedSource, classes: '' }];
  tokens = spliceTokens(
    tokens,
    jsxGenericRanges.map((range) => ({
      ...range,
      tokens: highlightAsTypeArg(emphasis.source.slice(range.from, range.to), lang),
    })),
  );
  tokens = splitTokensAtRanges(
    tokens,
    resolveTextHighlightRanges(emphasis.source, emphasis.textHighlights),
  );

  const root = toLinedHast(tokens, { highlightedLines: emphasis.highlightLines });
  return {
    ...root,
    data: {
      totalLines: emphasis.source.replace(/\n$/, '').split('\n').length,
      focusRange: emphasis.focusRange,
    },
  };
}

/** Splits a lined frame around a 1-indexed inclusive focus range. */
export function splitFocusFrameRange(
  root: ParseSourceRoot,
  startLine: number,
  endLine: number,
): ParseSourceRoot {
  const frame = root.children[0];
  if (root.children.length !== 1 || frame?.type !== 'element') {
    return root;
  }
  const boundaries = [0];
  let lines = 0;
  for (let index = 0; index < frame.children.length; index += 1) {
    if (frame.children[index].type === 'element') {
      lines += 1;
      boundaries[lines] = frame.children[index + 1]?.type === 'text' ? index + 2 : index + 1;
    }
  }
  if (startLine < 1 || endLine < startLine || startLine > lines) {
    return root;
  }
  const leadEnd = boundaries[startLine - 1];
  const focusEnd = boundaries[Math.min(endLine, lines)];
  if (leadEnd === 0 && focusEnd >= frame.children.length) {
    return root;
  }

  const children: Root['children'] = [];
  if (leadEnd > 0) {
    children.push({ ...frame, children: frame.children.slice(0, leadEnd) });
  }
  children.push({
    ...frame,
    properties: { ...frame.properties, dataFrameType: 'focus' },
    children: frame.children.slice(leadEnd, focusEnd),
  });
  if (focusEnd < frame.children.length) {
    children.push({ ...frame, children: frame.children.slice(focusEnd) });
  }
  return { ...root, children };
}

/** Splits a focus frame around the first N lines. */
export function splitFocusFrame(root: ParseSourceRoot, focusLines: number): ParseSourceRoot {
  return splitFocusFrameRange(root, 1, focusLines);
}

/** Returns the synchronous parser in the existing asynchronous factory shape. */
export async function createParseSource(): Promise<typeof parseSource> {
  return parseSource;
}
