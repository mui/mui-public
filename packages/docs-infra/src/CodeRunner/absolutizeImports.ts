import { parseImportsAndComments } from '../pipeline/loaderUtils/parseImportsAndComments';
import { rewriteImports } from '../pipeline/loaderUtils/rewriteImports';

/**
 * Specifier prefix under which an extra file's exports are registered in the
 * runner scope. Relative imports between extra files (and from the main source)
 * are rewritten to `<prefix><path-from-demo-root>`, so the runner's exact-key
 * `require` resolves them no matter where the importing file sits.
 */
export const SCOPE_IMPORT_PREFIX = '@mui/internal-docs-infra/CodeRunner/imports/';

/**
 * Rewrites a source's relative imports (`./x`, `../x`) to absolute specifiers
 * under {@link SCOPE_IMPORT_PREFIX}, resolving each against the importing file's
 * own directory. This lets every extra file be registered under a single absolute
 * key that resolves regardless of where the file lives — e.g. `dir/file.ts`
 * importing `../root` becomes `<prefix>root`, and `root.ts` importing `./dir/file`
 * becomes `<prefix>dir/file`. External (bare) specifiers are left untouched.
 *
 * Only needed when extra files span subdirectories; flat demos resolve fine with
 * their plain `./name` specifiers and should skip this. `fileName` is the file's
 * path within the demo (e.g. `dir/file.ts`); the main source lives at the root.
 */
export function absolutizeImports(
  source: string,
  fileName: string,
  prefix: string = SCOPE_IMPORT_PREFIX,
): string {
  const lastSlash = fileName.lastIndexOf('/');
  const fromDir = lastSlash === -1 ? '' : fileName.slice(0, lastSlash);

  // Reuse the loader's single-pass import scanner (it correctly skips specifiers
  // inside strings, comments, and template literals) to find each relative
  // specifier and the positions where it appears. The parse URL is a fixed JS
  // name, NOT the real `fileName`: the extra files routed here are always JS/TS,
  // and a `.mdx` name would otherwise switch the scanner into MDX mode (where
  // quotes no longer delimit strings). The directory is tracked separately above,
  // so the made-up URL doesn't affect resolution.
  const { relative } = parseImportsAndComments(source, 'file:///source.tsx');

  const mapping = new Map<string, string>();
  for (const specifier of Object.keys(relative)) {
    mapping.set(specifier, `${prefix}${resolveFromDir(fromDir, specifier)}`);
  }

  return rewriteImports(source, mapping, relative);
}

/**
 * Resolves a relative `specifier` against `fromDir` into a normalized path (no
 * leading `./`, `..` collapsed against real segments). A `..` that points ABOVE
 * the demo root is PRESERVED, not dropped: a demo can import a shared file outside
 * its own folder (`../shared/Button`), which a canonical `storeAt` mode keys by
 * that same `../`-prefixed path — so the resolved specifier must keep the `..` to
 * line up with the key. Pure string work — no Node `path` — so it runs unchanged
 * in the browser.
 */
function resolveFromDir(fromDir: string, specifier: string): string {
  const segments = fromDir ? fromDir.split('/') : [];
  segments.push(...specifier.split('/'));

  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      // Collapse against a real preceding segment; otherwise keep the `..` (the
      // path climbs above the root to a parent-directory file).
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else {
        stack.push('..');
      }
      continue;
    }
    stack.push(segment);
  }
  return stack.join('/');
}
