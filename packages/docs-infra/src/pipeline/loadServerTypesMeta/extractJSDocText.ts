/**
 * Renders a `{@link symbol}` reference into markdown.
 *
 * A link is emitted only when `symbol` is documented on the current page (so a
 * heading with a matching anchor exists). Otherwise the reference renders as a
 * plain code span - this keeps references to internal helpers, or to symbols
 * that live on another page, from producing dangling `#anchor` links that fail
 * the docs link checker.
 *
 * When `documentedNames` is omitted every reference is linked (legacy behavior,
 * used only when no documented-name set is threaded through).
 */
function renderJSDocLink(symbol: string, documentedNames?: Set<string>): string {
  if (!documentedNames || documentedNames.has(symbol)) {
    return `[\`${symbol}\`](#${symbol.toLowerCase()})`;
  }
  return `\`${symbol}\``;
}

/**
 * Extracts text content from a JSDoc description array.
 *
 * typescript-api-extractor returns a description as an array of JSDoc nodes when
 * the comment contains `{@link}` tags: plain-text nodes carry a `text` property,
 * while link nodes carry the referenced symbol in `name.escapedText`. Link nodes
 * are turned into markdown via {@link renderJSDocLink}, gated on `documentedNames`.
 */
export function extractJSDocText(nodes: unknown[], documentedNames?: Set<string>): string {
  return nodes
    .map((node) => {
      if (typeof node === 'object' && node !== null) {
        // Regular text nodes have a 'text' property with content
        if ('text' in node) {
          const text = (node as { text?: unknown }).text;
          if (typeof text === 'string' && text) {
            return text;
          }
        }
        // JSDocLink nodes (kind 325) have the symbol name in name.escapedText
        if ('name' in node) {
          const name = (node as { name?: { escapedText?: string } }).name;
          if (name && typeof name.escapedText === 'string') {
            return renderJSDocLink(name.escapedText, documentedNames);
          }
        }
      }
      return '';
    })
    .join('');
}

/**
 * Checks if an array looks like JSDoc description nodes from typescript-api-extractor.
 * These have properties like 'pos', 'end', 'kind', 'text' from the TypeScript AST.
 */
export function isJSDocNodeArray(value: unknown[]): boolean {
  if (value.length === 0) {
    return false;
  }
  const first = value[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    'pos' in first &&
    'end' in first &&
    'kind' in first
  );
}
