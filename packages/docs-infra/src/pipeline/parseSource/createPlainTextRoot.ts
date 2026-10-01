import type { ParseSource } from '../../CodeHighlighter/types';
import { starryNightGutter } from './addLineGutters';

// Lives apart from `parseSource.ts` so callers that only need plain text (the
// server fallback in `buildStringFallback`) don't statically pull the Starry
// Night engine (vscode-textmate + oniguruma + grammars) into the page bundle.
//
// Builds the plain-text HAST fallback used for unsupported file types and for a
// mapped-but-not-yet-registered scope. Line gutters are still added so the
// enhancer pipeline (e.g. auto-focus frames) can operate on the result.
export function createPlainTextRoot(source: string): ReturnType<ParseSource> {
  const root: ReturnType<ParseSource> = {
    type: 'root',
    children: [
      {
        type: 'text',
        value: source,
      },
    ],
  };
  const sourceLines = source.split(/\r?\n|\r/);
  starryNightGutter(root, sourceLines);
  return root;
}

/**
 * Parses source into a line-guttered HAST **without** syntax highlighting — the
 * raw text wrapped in the same `.line`/`.frame` structure `parseSource` produces,
 * just no starry-night tokenization. It is a `ParseSource` so it can be dropped
 * into the loader in place of the highlighting parser.
 *
 * Used for the deferred (un-highlighted) fallback: the enhancer pipeline needs the
 * line/frame structure to compute focus windows and truncation, but the syntax
 * colors are exactly the part being deferred — so we skip them. Cheap (no grammar,
 * no `getInstance`); the frames it produces collapse back to text via `buildRootFallback`.
 *
 * Takes only `source` (it ignores file name / language since it never highlights) but
 * stays structurally assignable to `ParseSource`, so it drops into the loader in place
 * of the highlighting parser.
 */
export const parsePlainText = (source: string): ReturnType<ParseSource> =>
  createPlainTextRoot(source);
