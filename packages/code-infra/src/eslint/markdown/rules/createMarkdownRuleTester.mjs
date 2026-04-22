import { RuleTester } from 'eslint';
import markdown from '@eslint/markdown';

/**
 * RuleTester preconfigured for `@eslint/markdown`. Casts smooth over the
 * mismatch between `MarkdownRuleDefinition` and ESLint's generic
 * `RuleDefinition` types.
 *
 * @returns {{ run: (name: string, rule: unknown, tests: unknown) => void }}
 */
export function createMarkdownRuleTester() {
  const tester = new RuleTester(
    /** @type {any} */ ({
      plugins: { markdown },
      language: 'markdown/gfm',
    }),
  );
  return {
    run(name, rule, tests) {
      tester.run(name, /** @type {any} */ (rule), /** @type {any} */ (tests));
    },
  };
}
