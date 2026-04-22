/**
 * Simple template string replacement utility.
 * Replaces placeholders like {{ key }} with values from an object.
 * Handles spacing variations: {{key}}, {{ key}}, {{ key }} are all treated the same.
 * If a value is undefined, the placeholder is removed from the output.
 *
 * @param {string} template - Template string with placeholders
 * @param {Record<string, any>} values - Object with template values
 * @returns {string} - Rendered string with placeholders replaced
 *
 * @example
 * const result = templateString('Hello {{ name }}, version {{ version }}', { name: 'Alice' });
 * // 'Hello Alice, version ' (version placeholder removed as it's undefined)
 *
 * @example
 * const result = templateString('Release {{ version }}', { version: '1.0.0' });
 * // 'Release 1.0.0'
 */
export function templateString(template, values) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return values[key] !== undefined ? String(values[key]) : '';
  });
}
