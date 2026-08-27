/** Composers that bind looser than `keyof`, and than each other in this order. */
export const UNION = '|';
export const UNION_OR_INTERSECTION = '|&';

/**
 * Whether a formatted type composes at its top level with one of `operators`, so it needs
 * grouping before being placed somewhere that binds tighter.
 *
 * Operators nested inside the type — an object's property type, a type argument, a function
 * signature — are already grouped by their own brackets and are left alone.
 */
export function hasTopLevelOperator(formatted: string, operators: string): boolean {
  let depth = 0;
  let quote = '';

  for (let index = 0; index < formatted.length; index += 1) {
    const char = formatted[index];

    if (quote) {
      if (char === quote) {
        quote = '';
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(' || char === '[' || char === '{' || char === '<') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
    } else if (char === '>' && formatted[index - 1] !== '=') {
      // `=>` is an arrow, not the end of a type argument list.
      depth -= 1;
    } else if (depth === 0 && operators.includes(char)) {
      return true;
    }
  }

  return false;
}

/** Wraps a formatted type in parentheses when it would otherwise re-associate. */
export function groupType(formatted: string, operators: string): string {
  return hasTopLevelOperator(formatted, operators) ? `(${formatted})` : formatted;
}
