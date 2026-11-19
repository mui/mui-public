import { describe, it, expect } from 'vitest';
import { grammarLoaders } from './grammarLoaders';
import { extensionMap, languageToGrammarMap } from './grammarMaps';

describe('grammarLoaders', () => {
  it('has a loader for every scope reachable from the extension and language maps', () => {
    // Detection (`detectGrammarScopes`, `parseSource`) only ever yields scopes
    // these maps produce, so a missing loader here would mean a detectable
    // language that can never be lazily registered.
    const reachable = new Set([
      ...Object.values(extensionMap),
      ...Object.values(languageToGrammarMap),
    ]);

    for (const scope of reachable) {
      expect(grammarLoaders[scope], `missing grammar loader for ${scope}`).toBeTypeOf('function');
    }
  });

  it('resolves every loader to a grammar whose scopeName matches its key', async () => {
    const entries = Object.entries(grammarLoaders);
    const grammars = await Promise.all(entries.map(([, load]) => load()));

    grammars.forEach((grammar, index) => {
      expect(grammar.scopeName).toBe(entries[index][0]);
    });
  });
});
