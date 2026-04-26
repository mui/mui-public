import { remark } from 'remark';
import remarkGfm from 'remark-gfm';

/**
 * @param {unknown} plugin
 * @param {unknown} [options]
 * @returns {(input: string) => Array<{ reason: string, line: number, column: number }>}
 */
export function createLintTester(plugin, options) {
  const entry = /** @type {any} */ (options === undefined ? plugin : [plugin, options]);
  return function lint(input) {
    const file = remark().use(remarkGfm).use(entry).processSync(input);
    return file.messages.map((message) => ({
      reason: message.reason,
      line: message.line ?? 0,
      column: message.column ?? 0,
    }));
  };
}
