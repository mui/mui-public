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
 * Converts import statements to const declarations set to null.
 * This preserves variable names while removing the actual imports.
 * Useful when precomputing data that makes the imports unnecessary.
 *
 * @param source - The source code to process
 * @param importPathsToRewrite - Set of import paths whose import statements should be rewritten
 * @param importResult - Import result with position and name data
 * @returns The source code with import statements rewritten to const declarations
 */
export function rewriteImportsToNull(
  source: string,
  importPathsToRewrite: Set<string>,
  importResult: Record<
    string,
    {
      positions: Array<{ start: number; end: number }>;
      names: Array<{ name: string; alias?: string; type: string }>;
    }
  >,
): string {
  const replacements: Array<{ start: number; end: number; newText: string }> = [];

  // Find all import statements to rewrite
  importPathsToRewrite.forEach((importPath) => {
    const importData = importResult[importPath];
    if (importData && importData.positions.length > 0) {
      // For each position (there should typically be one per import statement)
      for (const position of importData.positions) {
        // Parse backwards from the quote to find 'import' keyword
        let importStart = position.start;
        const targetWord = 'import';
        while (importStart >= targetWord.length) {
          const slice = source.slice(importStart - targetWord.length, importStart);
          const prevChar =
            importStart > targetWord.length ? source[importStart - targetWord.length - 1] : '';

          if (slice === targetWord && (!prevChar || /\s/.test(prevChar))) {
            importStart -= targetWord.length;
            break;
          }
          importStart -= 1;
        }

        // Parse forwards from after the closing quote to find semicolon/newline
        // position.end points to the character AFTER the closing quote
        let importEnd = position.end;

        // Check for optional semicolon
        if (importEnd < source.length && source[importEnd] === ';') {
          importEnd += 1;
        }

        // Check for newline after the statement
        let hasTrailingNewline = false;
        if (importEnd < source.length && source[importEnd] === '\n') {
          hasTrailingNewline = true;
          importEnd += 1;
        }

        // Generate const declarations from import names
        const constDeclarations = importData.names
          .map((nameInfo) => {
            const varName = nameInfo.alias || nameInfo.name;
            return `const ${varName} = null;`;
          })
          .join('\n');

        // Add newline if original import had one
        const newText = constDeclarations + (hasTrailingNewline ? '\n' : '');

        replacements.push({
          start: importStart,
          end: importEnd,
          newText,
        });
      }
    }
  });

  // Sort replacements by position (descending) to avoid position shifts
  replacements.sort((a, b) => b.start - a.start);

  // Apply replacements from right to left (using same logic as rewriteImports)
  let result = source;
  for (const replacement of replacements) {
    result =
      result.slice(0, replacement.start) + replacement.newText + result.slice(replacement.end);
  }

  return result;
}

/**
 * Removes entire import statements for the specified import paths.
 * This removes the full import line, not just the path.
 *
 * @param source - The source code to process
 * @param importPathsToRemove - Set of import paths whose entire import statements should be removed
 * @param importResult - Import result with position data
 * @returns The source code with import statements removed
 */
export function removeImports(
  source: string,
  importPathsToRemove: Set<string>,
  importResult: Record<string, { positions: Array<{ start: number; end: number }> }>,
): string {
  const linesToRemove: Set<number> = new Set();

  // Find all line numbers that contain imports to remove
  importPathsToRemove.forEach((importPath) => {
    const positions = importResult[importPath]?.positions;
    if (positions && positions.length > 0) {
      for (const position of positions) {
        // Find which line this position is on
        const beforePosition = source.slice(0, position.start);
        const lineNumber = (beforePosition.match(/\n/g) || []).length;
        linesToRemove.add(lineNumber);
      }
    }
  });

  // Split source into lines and filter out lines to remove
  const lines = source.split('\n');
  const filteredLines = lines.filter((_, index) => !linesToRemove.has(index));

  return filteredLines.join('\n');
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
