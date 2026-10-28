import type { Code, ControlledCode } from '../../CodeHighlighter/types';

/** Extensions whose files need the transpile + build engine when edited live. */
const JS_EXTENSIONS = ['.js', '.mjs', '.jsx', '.ts', '.tsx'];

/**
 * Detects which live-editing engine chunks a code block will need, by file
 * extension across every variant — so a host can PRELOAD them the moment editing
 * activates (before the first keystroke): `js` when any file is JS/TS/JSX/TSX/MJS
 * (it will be transpiled and built), `css` when any file is CSS (it will be
 * compiled). Reads only file names/keys, never source — cheap and synchronous, so
 * it can run on every render.
 *
 * Bare string variants (no file metadata) and `undefined` variants contribute
 * nothing.
 */
export function detectFileTypes(code: Code | ControlledCode): { js: boolean; css: boolean } {
  let js = false;
  let css = false;

  for (const variant of Object.values(code)) {
    if (!variant || typeof variant === 'string') {
      continue;
    }

    const fileNames = [
      variant.fileName,
      ...(variant.extraFiles ? Object.keys(variant.extraFiles) : []),
    ];
    for (const fileName of fileNames) {
      if (!fileName) {
        continue;
      }
      if (fileName.endsWith('.css')) {
        css = true;
      } else if (JS_EXTENSIONS.some((extension) => fileName.endsWith(extension))) {
        js = true;
      }
      if (js && css) {
        return { js, css };
      }
    }
  }

  return { js, css };
}
