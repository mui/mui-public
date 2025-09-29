/**
 * Interface for rewrite replacement operations.
 */
interface RewriteReplacement {
  /** Start position of the text to replace */
  start: number;
  /** End position of the text to replace */
  end: number;
  /** New text to replace with */
  newText: string;
}

/**
 * Efficiently rewrites import paths using position data.
 * This avoids regex parsing and uses precise position information for replacement.
 * Works for both JavaScript/TypeScript and CSS imports.
 *
 * @param source - The source code to process
 * @param importPathMapping - Map from original import paths to new import paths
 * @param importResult - Import result with position data
 * @returns The source code with rewritten import paths
 */
export function rewriteImports(
  source: string,
  importPathMapping: Map<string, string>,
  importResult: Record<string, { positions: Array<{ start: number; end: number }> }>,
): string {
  const replacements: RewriteReplacement[] = [];

  // Use precise position-based replacement
  importPathMapping.forEach((newPath, originalPath) => {
    const positions = importResult[originalPath]?.positions;
    if (positions && positions.length > 0) {
      // Process all positions where this import path appears
      for (const position of positions) {
        // Validate position bounds
        if (position.start >= 0 && position.end <= source.length && position.start < position.end) {
          // The positions include the quotes, so we need to preserve them
          const originalText = source.slice(position.start, position.end);
          if (originalText.length > 0) {
            const quote = originalText.charAt(0); // Get the original quote character
            const newText = `${quote}${newPath}${quote}`;

            replacements.push({
              start: position.start,
              end: position.end,
              newText,
            });
          }
        }
      }
    }
  });

  // Sort replacements by position (descending) to avoid position shifts
  replacements.sort((a, b) => b.start - a.start);

  // Apply replacements from right to left
  let result = source;
  for (const replacement of replacements) {
    result =
      result.slice(0, replacement.start) + replacement.newText + result.slice(replacement.end);
  }

  return result;
}
