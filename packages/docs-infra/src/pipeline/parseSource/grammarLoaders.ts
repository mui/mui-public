/**
 * Per-scope grammar loaders. Every language ships in the one highlighting
 * engine chunk (`./highlightToHast`), so each loader starts that chunk's
 * download and resolves to a lightweight descriptor of the scope it registers.
 * `ensureGrammars` (in `./parseSource`) resolves only the scopes a block needs.
 *
 * Keys are grammar scope names — the same values `./grammarMaps` resolves file
 * extensions and language props to, so every detectable language has a loader
 * (asserted in the tests).
 */

/** A registrable grammar scope; `dependencies` are registered along with it. */
export interface Grammar {
  scopeName: string;
  dependencies?: string[];
}

export type GrammarLoader = () => Promise<Grammar>;

function loader(scopeName: string, dependencies?: string[]): GrammarLoader {
  return async () => {
    await import('./highlightToHast');
    return dependencies ? { scopeName, dependencies } : { scopeName };
  };
}

export const grammarLoaders: Record<string, GrammarLoader> = {
  'source.diff': loader('source.diff'),
  'source.js': loader('source.js'),
  'source.ts': loader('source.ts'),
  'source.tsx': loader('source.tsx'),
  'source.json': loader('source.json'),
  'text.md': loader('text.md'),
  // MDX embeds TSX, so registering it registers TSX too.
  'source.mdx': loader('source.mdx', ['source.tsx']),
  'text.html.basic': loader('text.html.basic'),
  'source.css': loader('source.css'),
  'source.shell': loader('source.shell'),
  'source.yaml': loader('source.yaml'),
};
