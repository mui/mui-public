/**
 * Converts a camelCase string to kebab-case.
 * Examples: "firstName" → "first-name", "name" → "name", "HTMLElement" → "h-t-m-l-element"
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
