import type {
  EditableSourceProjection,
  HastRoot,
  SourceComments,
} from '../../CodeHighlighter/types';

const VISIBLE_FRAME_TYPES = new Set(['highlighted', 'focus', 'padding-top', 'padding-bottom']);

function hasFocusMetadata(comments: SourceComments | undefined): boolean {
  return Object.values(comments ?? {}).some((lineComments) =>
    lineComments.some((comment) => {
      let tokenEnd = 0;
      if (comment.startsWith('@focus')) {
        tokenEnd = '@focus'.length;
      } else if (comment.startsWith('@highlight')) {
        tokenEnd = '@highlight'.length;
      }
      const nextCharacter = comment[tokenEnd];
      return (
        tokenEnd > 0 &&
        (nextCharacter === undefined || nextCharacter === '-' || /\s/.test(nextCharacter))
      );
    }),
  );
}

function getLineOffsets(source: string): Array<{ start: number; end: number }> {
  const offsets: Array<{ start: number; end: number }> = [];
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== '\n' && character !== '\r') {
      continue;
    }

    offsets.push({ start, end: index });
    if (character === '\r' && source[index + 1] === '\n') {
      index += 1;
    }
    start = index + 1;
  }

  offsets.push({ start, end: source.length });
  return offsets;
}

/**
 * Creates a safe contiguous source slice for the frames visible while collapsed.
 */
export function createEditableSourceProjection(
  source: string,
  root: HastRoot,
  comments: SourceComments | undefined,
): EditableSourceProjection | undefined {
  if (!hasFocusMetadata(comments)) {
    return undefined;
  }

  const visibleLines = new Set<number>();
  const indentLevels: number[] = [];
  for (const frame of root.children) {
    if (
      frame.type !== 'element' ||
      !VISIBLE_FRAME_TYPES.has(String(frame.properties?.dataFrameType))
    ) {
      continue;
    }

    if (typeof frame.properties?.dataFrameIndent === 'number') {
      indentLevels.push(frame.properties.dataFrameIndent);
    }

    for (const child of frame.children) {
      if (
        child.type === 'element' &&
        child.properties?.className === 'line' &&
        typeof child.properties.dataLn === 'number'
      ) {
        visibleLines.add(child.properties.dataLn);
      }
    }
  }

  const lineNumbers = Array.from(visibleLines).sort((first, second) => first - second);
  if (lineNumbers.length === 0) {
    return undefined;
  }
  for (let index = 1; index < lineNumbers.length; index += 1) {
    if (lineNumbers[index] !== lineNumbers[index - 1] + 1) {
      return undefined;
    }
  }

  const lineOffsets = getLineOffsets(source);
  const firstLine = lineOffsets[lineNumbers[0] - 1];
  const lastLine = lineOffsets[lineNumbers[lineNumbers.length - 1] - 1];
  if (!firstLine || !lastLine) {
    return undefined;
  }

  const indentLevel = indentLevels.length > 0 ? Math.min(...indentLevels) : 0;
  return {
    source: source.slice(firstLine.start, lastLine.end),
    start: firstLine.start,
    end: lastLine.end,
    ...(indentLevel > 0 ? { indentation: ' '.repeat(indentLevel * 2) } : null),
  };
}
