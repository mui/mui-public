/**
 * The prefix used to identify emphasis comments in source code.
 * Comments starting with this prefix will be processed for emphasis.
 */
export const EMPHASIS_COMMENT_PREFIX = '@highlight';

/**
 * The prefix used to identify focus-only comments in source code.
 * Comments starting with this prefix will mark the region as focused without highlighting.
 */
export const FOCUS_COMMENT_PREFIX = '@focus';

/**
 * Modifier token used inside focused `@highlight` / `@focus` comments
 * to override padding for that focus region.
 * Example: combine `@highlight`, `@focus`, and `@padding 2`.
 */
export const PADDING_COMMENT_PREFIX = '@padding';

/**
 * Modifier token used inside focused `@highlight` / `@focus` comments
 * to override the maximum size for that focus region.
 * Example: combine `@highlight`, `@focus`, and `@min 6`.
 */
export const MIN_COMMENT_PREFIX = '@min';

/**
 * Replaces quoted content with underscores of the same length so directive
 * matching only sees unquoted text. Backslash-escaped characters stay inside
 * the current quoted section.
 */
export function maskQuotedContent(content: string): string {
  let result = '';
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      result += '_';
      if (character === '\\' && index + 1 < content.length) {
        index += 1;
        result += '_';
      } else if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      result += '_';
    } else {
      result += character;
    }
  }

  return result;
}

/**
 * Extracts quoted strings while treating backslash-escaped quote characters
 * as content. Returned strings preserve their original escape sequences.
 */
export function extractQuotedCommentStrings(content: string): string[] {
  const strings: string[] = [];
  let quote: '"' | "'" | undefined;
  let contentStart = -1;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (character === '\\' && index + 1 < content.length) {
        index += 1;
      } else if (character === quote) {
        if (index > contentStart) {
          strings.push(content.slice(contentStart, index));
        }
        quote = undefined;
        contentStart = -1;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      contentStart = index + 1;
    }
  }

  return strings;
}

/**
 * Collects whitespace-delimited comment tokens while ignoring quoted text.
 */
export function getUnquotedCommentTokens(comment: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  let quote: '"' | "'" | undefined;

  function pushCurrentToken(): void {
    if (currentToken) {
      tokens.push(currentToken);
      currentToken = '';
    }
  }

  for (let index = 0; index < comment.length; index += 1) {
    const character = comment[index];
    if (quote) {
      if (character === '\\' && index + 1 < comment.length) {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      pushCurrentToken();
      quote = character;
    } else if (
      character === ' ' ||
      character === '\t' ||
      character === '\n' ||
      character === '\r'
    ) {
      pushCurrentToken();
    } else {
      currentToken += character;
    }
  }

  pushCurrentToken();
  return tokens;
}

/**
 * Returns whether a parsed comment contains a real focus directive.
 */
export function hasFocusDirective(comment: string): boolean {
  const tokens = getUnquotedCommentTokens(comment);
  const firstToken = tokens[0];

  if (
    firstToken === FOCUS_COMMENT_PREFIX ||
    firstToken === `${FOCUS_COMMENT_PREFIX}-start` ||
    firstToken === `${FOCUS_COMMENT_PREFIX}-end`
  ) {
    return true;
  }

  const acceptsFocusModifier =
    firstToken === EMPHASIS_COMMENT_PREFIX ||
    firstToken === `${EMPHASIS_COMMENT_PREFIX}-start` ||
    firstToken === `${EMPHASIS_COMMENT_PREFIX}-text`;
  return acceptsFocusModifier && tokens.includes(FOCUS_COMMENT_PREFIX);
}
