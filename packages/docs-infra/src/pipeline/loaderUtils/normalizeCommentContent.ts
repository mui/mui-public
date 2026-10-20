/**
 * Removes JSDoc decoration from parsed block comment content. Comment delimiters
 * have already been removed by the source parser or ESLint.
 */
export function normalizeCommentContent(content: string): string {
  if (!content.trimStart().startsWith('*')) {
    return content;
  }

  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith('*') ? trimmed.slice(1).trimStart() : line;
    })
    .join('\n');
}
