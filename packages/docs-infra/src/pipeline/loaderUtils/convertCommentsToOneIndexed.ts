import type { SourceComments } from '../../CodeHighlighter/types';

/**
 * Convert comments from 0-based to 1-based line numbers.
 *
 * `parseImportsAndComments` emits 0-based line numbers, but the rest of the
 * pipeline (HAST `dataLn`, source enhancers) uses 1-based lines.
 */
export function convertCommentsToOneIndexed(
  comments: SourceComments | undefined,
): SourceComments | undefined {
  if (!comments) {
    return undefined;
  }
  const converted: SourceComments = {};
  for (const [lineStr, commentArray] of Object.entries(comments)) {
    converted[parseInt(lineStr, 10) + 1] = commentArray;
  }
  return converted;
}
