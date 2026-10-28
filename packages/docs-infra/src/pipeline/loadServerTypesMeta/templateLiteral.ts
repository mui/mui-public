import type * as tae from 'typescript-api-extractor';

/**
 * Writes a template literal type as TypeScript source, such as `` `${number}px` ``.
 *
 * Placeholders are formatted by the caller, so each formatter keeps its own rules for the
 * types inside them.
 */
export function formatTemplateLiteral(
  type: tae.TemplateLiteralNode,
  formatPlaceholder: (placeholder: tae.AnyType) => string,
): string {
  const placeholders = type.types.map(
    (placeholder, index) =>
      `\${${formatPlaceholder(placeholder)}}${escapeTemplateText(type.texts[index + 1])}`,
  );
  return `\`${escapeTemplateText(type.texts[0])}${placeholders.join('')}\``;
}

/**
 * Escapes the characters that would otherwise end the template, start a placeholder or an
 * escape, or be read back as a line feed.
 */
function escapeTemplateText(text: string): string {
  return text.replace(/\\|`|\$\{|\r/g, (match) => (match === '\r' ? '\\r' : `\\${match}`));
}
