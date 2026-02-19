import { prettyDOM } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'test', 'html-dumps');

/**
 * Dumps the HTML of a container (or `document.body`) to a file for debugging.
 *
 * @param options.container - The element to dump. Defaults to `document.body`.
 * @param options.filePath - Absolute path for the output file. When omitted a file is
 *   created inside `test/html-dumps/` using the provided `fileName` (or a timestamp).
 * @param options.fileName - Name of the file (without extension) when `filePath` is not set.
 */
export function dumpHTML({
  container = document.body,
  filePath,
  fileName,
}: {
  container?: HTMLElement;
  filePath?: string;
  fileName?: string;
} = {}): string {
  const html = prettyDOM(container, Infinity) || '';

  const resolvedPath = filePath ?? path.join(DEFAULT_OUTPUT_DIR, `${fileName ?? Date.now()}.html`);

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, html, 'utf-8');

  return resolvedPath;
}
