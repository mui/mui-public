/**
 * Heavy highlighting engine: `@pierre/highlights` (a WebAssembly lexer with
 * every supported language built in) plus the conversion of its tokens into
 * HAST. Import it dynamically (see `./parseSource`) so bundlers keep the Wasm
 * payload out of chunks that never highlight.
 */
import { codeToTokens } from '@pierre/highlights';
import type { Lang, Theme } from '@pierre/highlights';
import type { Root } from 'hast';
import { diffLine, HastBuilder, mergeText, SCOPE_MODES } from './buildPrettylightsHast';
import type { Piece } from './splitHighlightTokens';
import { splitLines, splitToken, tokenType } from './splitHighlightTokens';

/** Maps the grammar scopes docs-infra resolves languages to onto highlights language ids. */
export const SCOPE_LANGUAGES: Record<string, Lang> = {
  'source.js': 'js',
  'source.ts': 'ts',
  'source.tsx': 'tsx',
  'source.json': 'json',
  'text.md': 'md',
  'source.mdx': 'mdx',
  'text.html.basic': 'html',
  'source.css': 'css',
  'source.shell': 'sh',
  'source.yaml': 'yaml',
  'source.diff': 'diff',
};

/**
 * With CSS-variable colors, every token's color is `var(--hls-{token-type})`,
 * which exposes the lexer's token type (`keyword-import`, `tag-jsx`, …).
 */
const TOKEN_TYPE_THEME: Theme = {
  name: 'docs-infra-token-types',
  appearance: 'light',
  style: {},
  cssVariables: true,
};

/**
 * Highlights `source` for a grammar scope and returns HAST in the
 * prettylights vocabulary. Returns `undefined` for a scope highlights does not
 * support, or when the tokens do not reproduce the source exactly, so callers
 * can fall back to plain text.
 */
export function highlightToHast(source: string, scope: string): Root | undefined {
  const lang = SCOPE_LANGUAGES[scope];
  if (!lang) {
    return undefined;
  }
  const { lines, terminators } = splitLines(source);
  if (lang === 'diff') {
    return {
      type: 'root',
      children: mergeText(
        lines.flatMap((line, index) => [
          ...diffLine(line),
          ...(terminators[index] ? [{ type: 'text' as const, value: terminators[index] }] : []),
        ]),
      ),
    };
  }
  const { tokens } = codeToTokens(source, { lang, theme: TOKEN_TYPE_THEME });
  if (tokens.length !== lines.length) {
    return undefined;
  }
  const pieces: Piece[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const linePieces: Piece[] = [];
    let text = '';
    tokens[index].forEach((token, tokenIndex) => {
      splitToken(
        token.content,
        tokenType(token.color),
        linePieces,
        tokenIndex === 0,
        tokenIndex === tokens[index].length - 1,
      );
      text += token.content;
    });
    if (text !== lines[index]) {
      return undefined;
    }
    pieces.push(linePieces);
  }
  return new HastBuilder(SCOPE_MODES[scope]).build(pieces, terminators);
}
