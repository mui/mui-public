import type { Code, ControlledCode } from '../../CodeHighlighter/types';
import { resolveGrammarScope } from './grammarMaps';

/**
 * Enumerates the unique grammar scopes a code block needs to highlight every
 * file across all of its variants — the main file plus each extra file, by
 * extension or explicit `language`. Cheap and synchronous (it reads only the
 * lightweight metadata, never the grammar JSON), so it can run on every render
 * to drive a speculative grammar preload.
 *
 * Variants that are bare source strings (no file metadata) or `undefined`, and
 * files whose extension/language maps to no supported grammar, contribute no
 * scope.
 */
export function detectGrammarScopes(code: Code | ControlledCode): string[] {
  const scopes = new Set<string>();

  for (const variant of Object.values(code)) {
    if (!variant || typeof variant === 'string') {
      continue;
    }

    const mainScope = resolveGrammarScope(variant.fileName, variant.language);
    if (mainScope) {
      scopes.add(mainScope);
    }

    if (variant.extraFiles) {
      for (const [fileName, extra] of Object.entries(variant.extraFiles)) {
        const language =
          extra &&
          typeof extra === 'object' &&
          'language' in extra &&
          typeof extra.language === 'string'
            ? extra.language
            : undefined;
        const scope = resolveGrammarScope(fileName, language);
        if (scope) {
          scopes.add(scope);
        }
      }
    }
  }

  return [...scopes];
}
