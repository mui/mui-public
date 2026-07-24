import type { Language, Token } from './highlight';

const HIGHLIGHT_TEXT = '@highlight-text';

const DIRECTIVE_TOKENS: Record<
  string,
  { kind: 'highlight' | 'focus'; type: 'single' | 'start' | 'end' }
> = {
  '@highlight': { kind: 'highlight', type: 'single' },
  '@highlight-start': { kind: 'highlight', type: 'start' },
  '@highlight-end': { kind: 'highlight', type: 'end' },
  '@focus': { kind: 'focus', type: 'single' },
  '@focus-start': { kind: 'focus', type: 'start' },
  '@focus-end': { kind: 'focus', type: 'end' },
};

export interface FocusRange {
  start: number;
  end: number;
}

export interface Emphasis {
  source: string;
  highlightLines: Set<number>;
  textHighlights: Map<number, string[]>;
  focusRange: FocusRange | null;
}

type ParsedDirective =
  | {
      kind: 'highlight' | 'focus';
      type: 'single' | 'start' | 'end';
      padding: number;
      focus: boolean;
    }
  | { kind: 'text'; texts: string[] };

interface FoundDirective {
  parsed: ParsedDirective;
  from: number;
  to: number;
  originalLine: number;
  finalOffset: number;
}

function isBlank(char: string): boolean {
  return char === ' ' || char === '\t';
}

function commentInnerText(raw: string): string {
  return raw.startsWith('//') ? raw.slice(2) : raw.slice(2, -2);
}

function parsePaddingModifier(rest: string[]): number {
  const index = rest.indexOf('@padding');
  if (index === -1) {
    return 0;
  }
  const value = Number.parseInt(rest[index + 1] ?? '', 10);
  return Number.isNaN(value) || value < 0 ? 0 : value;
}

function parseDirective(content: string): ParsedDirective | null {
  const trimmed = content.trim();
  if (trimmed.startsWith(HIGHLIGHT_TEXT)) {
    const texts = [...trimmed.slice(HIGHLIGHT_TEXT.length).matchAll(/"([^"]*)"/g)].map(
      (match) => match[1],
    );
    return texts.length > 0 ? { kind: 'text', texts } : null;
  }
  const [first, ...rest] = trimmed.split(/\s+/);
  const directive = DIRECTIVE_TOKENS[first];
  if (!directive) {
    return null;
  }
  const focus = directive.kind === 'highlight' && rest.includes('@focus');
  return { ...directive, padding: parsePaddingModifier(rest), focus };
}

/** Returns the untouched source with no emphasis metadata. */
export function emptyEmphasis(source: string): Emphasis {
  return { source, highlightLines: new Set(), textHighlights: new Map(), focusRange: null };
}

/** Extracts and strips supported emphasis directives from source comments. */
export function extractEmphasis(source: string, lang: Language): Emphasis {
  if (!lang.commentNodes || !/@(?:highlight|focus)/.test(source)) {
    return emptyEmphasis(source);
  }

  const directives: FoundDirective[] = [];
  lang.parser.parse(source).iterate({
    enter(node) {
      if (!lang.commentNodes?.has(node.name)) {
        return;
      }
      const parsed = parseDirective(commentInnerText(source.slice(node.from, node.to)));
      if (parsed) {
        directives.push({ parsed, from: node.from, to: node.to, originalLine: 0, finalOffset: 0 });
      }
    },
  });
  if (directives.length === 0) {
    return emptyEmphasis(source);
  }

  const removals: Array<{ from: number; to: number }> = [];
  const removedOriginalLines: number[] = [];
  for (const directive of directives) {
    const lineStart = source.lastIndexOf('\n', directive.from - 1) + 1;
    const nextLine = source.indexOf('\n', directive.to);
    const lineEnd = nextLine === -1 ? source.length : nextLine;
    const originalLine = source.slice(0, lineStart).split('\n').length;

    let from = directive.from;
    let to = directive.to;
    if (source[from - 1] === '{') {
      from -= 1;
    }
    if (source[to] === '}') {
      to += 1;
    }

    const commentOnly = source.slice(lineStart, lineEnd).trim() === source.slice(from, to).trim();
    if (commentOnly) {
      removals.push({ from: lineStart, to: lineEnd < source.length ? lineEnd + 1 : lineEnd });
      removedOriginalLines.push(originalLine);
    } else {
      while (from > lineStart && isBlank(source[from - 1])) {
        from -= 1;
      }
      while (to < lineEnd && isBlank(source[to])) {
        to += 1;
      }
      removals.push({ from, to });
    }
    const { parsed } = directive;
    directive.originalLine = originalLine;
    directive.finalOffset = commentOnly && parsed.kind !== 'text' && parsed.type === 'end' ? -1 : 0;
  }
  removedOriginalLines.sort((first, second) => first - second);

  const toFinalLine = (originalLine: number): number => {
    let removedBefore = 0;
    for (const removed of removedOriginalLines) {
      if (removed < originalLine) {
        removedBefore += 1;
      } else {
        break;
      }
    }
    return originalLine - removedBefore;
  };

  removals.sort((first, second) => first.from - second.from);
  let strippedSource = '';
  let cursor = 0;
  for (const removal of removals) {
    strippedSource += source.slice(cursor, removal.from);
    cursor = removal.to;
  }
  strippedSource += source.slice(cursor);

  const highlightLines = new Set<number>();
  const textHighlights = new Map<number, string[]>();
  let focusStart: number | undefined;
  let focusEnd: number | undefined;
  const highlightStack: Array<{ line: number; focus: boolean; padding: number }> = [];
  const focusStack: Array<{ line: number; padding: number }> = [];
  const addFocus = (rangeStart: number, rangeEnd: number, padding: number) => {
    focusStart =
      focusStart === undefined ? rangeStart - padding : Math.min(focusStart, rangeStart - padding);
    focusEnd = focusEnd === undefined ? rangeEnd + padding : Math.max(focusEnd, rangeEnd + padding);
  };

  for (const directive of directives) {
    const finalLine = toFinalLine(directive.originalLine) + directive.finalOffset;
    const { parsed } = directive;
    if (parsed.kind === 'text') {
      const existing = textHighlights.get(finalLine) ?? [];
      textHighlights.set(finalLine, [...existing, ...parsed.texts]);
      continue;
    }
    if (parsed.kind === 'highlight') {
      if (parsed.type === 'start') {
        highlightStack.push({ line: finalLine, focus: parsed.focus, padding: parsed.padding });
        continue;
      }
      let rangeStart = finalLine;
      let focus = parsed.focus;
      let padding = parsed.padding;
      if (parsed.type === 'end') {
        const opener = highlightStack.pop();
        if (opener === undefined) {
          continue;
        }
        rangeStart = opener.line;
        focus = opener.focus;
        padding = opener.padding;
      }
      for (let line = rangeStart; line <= finalLine; line += 1) {
        highlightLines.add(line);
      }
      if (focus) {
        addFocus(rangeStart, finalLine, padding);
      }
      continue;
    }
    if (parsed.type === 'start') {
      focusStack.push({ line: finalLine, padding: parsed.padding });
      continue;
    }
    let opener: { line: number; padding: number } | undefined;
    if (parsed.type === 'end') {
      opener = focusStack.pop();
      if (opener === undefined) {
        continue;
      }
    }
    const rangeStart = opener?.line ?? finalLine;
    addFocus(rangeStart, finalLine, Math.max(parsed.padding, opener?.padding ?? 0));
  }

  let focusRange: FocusRange | null = null;
  if (focusStart !== undefined && focusEnd !== undefined) {
    const totalLines = strippedSource.replace(/\n$/, '').split('\n').length;
    focusRange = { start: Math.max(1, focusStart), end: Math.min(totalLines, focusEnd) };
  }

  return { source: strippedSource, highlightLines, textHighlights, focusRange };
}

function overlapsClaimed(
  claimed: Array<{ from: number; to: number }>,
  from: number,
  to: number,
): boolean {
  return claimed.some((range) => from < range.to && to > range.from);
}

/** Resolves text emphasis targets to absolute source ranges. */
export function resolveTextHighlightRanges(
  source: string,
  textHighlights: Map<number, string[]>,
): Array<{ from: number; to: number }> {
  if (textHighlights.size === 0) {
    return [];
  }
  const lines = source.split('\n');
  const ranges: Array<{ from: number; to: number }> = [];
  let lineStart = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const texts = textHighlights.get(index + 1);
    if (texts) {
      const claimed: Array<{ from: number; to: number }> = [];
      for (const text of texts) {
        let textIndex = lines[index].indexOf(text);
        while (textIndex !== -1 && overlapsClaimed(claimed, textIndex, textIndex + text.length)) {
          textIndex = lines[index].indexOf(text, textIndex + 1);
        }
        if (textIndex !== -1) {
          claimed.push({ from: textIndex, to: textIndex + text.length });
          ranges.push({ from: lineStart + textIndex, to: lineStart + textIndex + text.length });
        }
      }
    }
    lineStart += lines[index].length + 1;
  }
  ranges.sort((first, second) => first.from - second.from);
  return ranges;
}

/** Splits tokens at source ranges and marks the matching token segments. */
export function splitTokensAtRanges(
  tokens: Token[],
  ranges: Array<{ from: number; to: number }>,
): Token[] {
  if (ranges.length === 0) {
    return tokens;
  }
  const result: Token[] = [];
  let rangeIndex = 0;
  let offset = 0;
  for (const token of tokens) {
    const tokenEnd = offset + token.text.length;
    let cursor = offset;
    while (rangeIndex < ranges.length && ranges[rangeIndex].from < tokenEnd) {
      const range = ranges[rangeIndex];
      const from = Math.max(range.from, cursor);
      const to = Math.min(range.to, tokenEnd);
      if (from > cursor) {
        result.push({
          text: token.text.slice(cursor - offset, from - offset),
          classes: token.classes,
        });
      }
      if (to > from) {
        result.push({
          text: token.text.slice(from - offset, to - offset),
          classes: token.classes,
          mark: true,
        });
      }
      cursor = to;
      if (range.to > tokenEnd) {
        break;
      }
      rangeIndex += 1;
    }
    if (cursor < tokenEnd) {
      result.push({ text: token.text.slice(cursor - offset), classes: token.classes });
    }
    offset = tokenEnd;
  }
  return result;
}
