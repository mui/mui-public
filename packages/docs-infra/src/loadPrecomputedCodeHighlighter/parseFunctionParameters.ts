/**
 * Utility function for parsing function parameters and handling nested structures
 * in JavaScript/TypeScript code.
 */

export interface ParsedParameters {
  /** The raw parameter strings split by top-level commas */
  parts: string[];
  /** Extracted balanced brace objects from each part (null if not an object) */
  objects: (string | null)[];
}

/**
 * Parses function parameters, splitting by top-level commas and extracting object literals.
 * This combines comma-splitting with object extraction for common use cases.
 */
export function parseFunctionParameters(str: string): ParsedParameters {
  const parts: string[] = [];
  const objects: (string | null)[] = [];
  let current = '';
  let parenCount = 0;
  let braceCount = 0;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i += 1) {
    const char = str[i];
    const nextChar = str[i + 1];

    // Handle comments
    if (!inString && !inSingleLineComment && !inMultiLineComment) {
      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        current += char;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        current += char;
        continue;
      }
    }

    if (inSingleLineComment && char === '\n') {
      inSingleLineComment = false;
      current += char;
      continue;
    }

    if (inMultiLineComment && char === '*' && nextChar === '/') {
      inMultiLineComment = false;
      current += char + nextChar;
      i += 1; // Skip next character
      continue;
    }

    if (inSingleLineComment || inMultiLineComment) {
      current += char;
      continue;
    }

    // Handle strings
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (inString && char === stringChar && str[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
      current += char;
      continue;
    }

    if (inString) {
      current += char;
      continue;
    }

    // Handle brackets and parentheses
    if (char === '(') {
      parenCount += 1;
    } else if (char === ')') {
      parenCount -= 1;
    } else if (char === '{') {
      braceCount += 1;
    } else if (char === '}') {
      braceCount -= 1;
    } else if (char === ',' && parenCount === 0 && braceCount === 0) {
      const trimmedPart = current.trim();
      parts.push(trimmedPart);
      objects.push(extractBalancedBraces(trimmedPart));
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    const trimmedPart = current.trim();
    parts.push(trimmedPart);
    objects.push(extractBalancedBraces(trimmedPart));
  }

  return { parts, objects };
}

/**
 * Extracts a balanced brace object from a string, handling leading whitespace and comments
 */
export function extractBalancedBraces(str: string): string | null {
  // Find the first opening brace, skipping whitespace and comments
  let startIndex = -1;
  let inSingleLineComment = false;
  let inMultiLineComment = false;

  for (let i = 0; i < str.length; i += 1) {
    const char = str[i];
    const nextChar = str[i + 1];

    // Handle comments
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        i += 1; // Skip next character
        continue;
      }
    }

    if (inSingleLineComment && char === '\n') {
      inSingleLineComment = false;
      continue;
    }

    if (inMultiLineComment && char === '*' && nextChar === '/') {
      inMultiLineComment = false;
      i += 1; // Skip next character
      continue;
    }

    if (inSingleLineComment || inMultiLineComment) {
      continue;
    }

    // Skip whitespace
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      continue;
    }

    // Found first non-whitespace, non-comment character
    if (char === '{') {
      startIndex = i;
      break;
    } else {
      // If it's not a brace, this isn't a valid object
      return null;
    }
  }

  if (startIndex === -1) {
    return null;
  }

  let braceCount = 0;
  let endIndex = -1;

  for (let i = startIndex; i < str.length; i += 1) {
    if (str[i] === '{') {
      braceCount += 1;
    } else if (str[i] === '}') {
      braceCount -= 1;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }
  }

  return endIndex !== -1 ? str.substring(startIndex, endIndex + 1) : null;
}
