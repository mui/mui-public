import * as path from 'node:path';
import { minimatch } from 'minimatch';
import { unified } from 'unified';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkLint from 'remark-lint';
import remarkLintCodeBlockStyle from 'remark-lint-code-block-style';
import remarkLintFencedCodeFlag from 'remark-lint-fenced-code-flag';
import remarkLintFirstHeadingLevel from 'remark-lint-first-heading-level';
import remarkLintHeadingIncrement from 'remark-lint-heading-increment';
import remarkLintHeadingStyle from 'remark-lint-heading-style';
import remarkLintNoDuplicateHeadings from 'remark-lint-no-duplicate-headings';
import remarkLintNoEmptyUrl from 'remark-lint-no-empty-url';
import remarkLintNoHeadingPunctuation from 'remark-lint-no-heading-punctuation';
import remarkLintNoMultipleToplevelHeadings from 'remark-lint-no-multiple-toplevel-headings';
import remarkLintNoUndefinedReferences from 'remark-lint-no-undefined-references';
import remarkLintNoUnusedDefinitions from 'remark-lint-no-unused-definitions';
import remarkLintTablePipes from 'remark-lint-table-pipes';
import muiFirstBlockHeading from './firstBlockHeading.mjs';
import muiGitDiff from './gitDiff.mjs';
import muiNoSpaceInLinks from './noSpaceInLinks.mjs';
import muiStraightQuotes from './straightQuotes.mjs';
import muiTableAlignment from './tableAlignment.mjs';
import muiTerminalLanguage from './terminalLanguage.mjs';

const GITHUB_ALERT_LABELS = ['!NOTE', '!TIP', '!WARNING', '!IMPORTANT', '!CAUTION'];

const RULES = {
  'no-duplicate-headings': [remarkLintNoDuplicateHeadings, ['error']],
  'no-multiple-toplevel-headings': [remarkLintNoMultipleToplevelHeadings, ['error']],
  'no-undefined-references': [
    remarkLintNoUndefinedReferences,
    ['error', { allow: GITHUB_ALERT_LABELS, allowShortcutLink: true }],
  ],
  'no-unused-definitions': [remarkLintNoUnusedDefinitions, ['error']],
  'heading-style': [remarkLintHeadingStyle, ['error', 'atx']],
  'heading-increment': [remarkLintHeadingIncrement, ['error']],
  'first-heading-level': [remarkLintFirstHeadingLevel, ['error', 1]],
  'no-heading-punctuation': [remarkLintNoHeadingPunctuation, ['error', '.,;:!']],
  'code-block-style': [remarkLintCodeBlockStyle, ['error', 'fenced']],
  'fenced-code-flag': [remarkLintFencedCodeFlag, ['error']],
  'no-empty-url': [remarkLintNoEmptyUrl, ['error']],
  'table-pipes': [remarkLintTablePipes, ['error']],
  'mui-first-block-heading': [muiFirstBlockHeading, ['error']],
  'mui-git-diff': [muiGitDiff, ['error']],
  'mui-no-space-in-links': [muiNoSpaceInLinks, ['error']],
  'mui-straight-quotes': [muiStraightQuotes, ['error']],
  'mui-table-alignment': [muiTableAlignment, ['error']],
  'mui-terminal-language': [muiTerminalLanguage, ['error']],
};

/**
 * @param {string | undefined} filePath
 */
function relativePath(filePath) {
  if (!filePath) {
    return filePath;
  }
  if (path.isAbsolute(filePath)) {
    return path.relative(process.cwd(), filePath);
  }
  return filePath;
}

/**
 * Wraps a remark-lint plugin so its transformer dispatches at runtime based on
 * `file.path`. Each variant (base + per-override) runs through its own mini
 * unified pipeline so severity, baked in by `unified-lint-rule` at attach time,
 * is preserved correctly.
 *
 * @param {string} name
 * @param {import('unified').Plugin<any[], any, any>} plugin
 * @param {any} baseSettings
 * @param {Array<{ files: string | string[], settings: false | any }>} overrideEntries
 */
function withOverrides(name, plugin, baseSettings, overrideEntries) {
  const baseProcessor = unified().use(plugin, baseSettings);
  const variants = overrideEntries.map(({ files, settings }) => ({
    files: Array.isArray(files) ? files : [files],
    processor: settings === false ? null : unified().use(plugin, settings),
  }));
  function wrapper() {
    /** @type {import('unified').Transformer} */
    return async function transformer(tree, file) {
      const candidate = relativePath(file.path);
      const matched = candidate
        ? variants.find((variant) => variant.files.some((pattern) => minimatch(candidate, pattern)))
        : undefined;
      if (matched) {
        if (matched.processor) {
          await matched.processor.run(tree, file);
        }
        return;
      }
      await baseProcessor.run(tree, file);
    };
  }
  Object.defineProperty(wrapper, 'name', { value: `mui-remark-overrides(${name})` });
  return wrapper;
}

/**
 * Returns a remark preset wiring the MUI-authored remark-lint plugins together
 * with a curated set of community plugins. Drop this into `.remarkrc.mjs`:
 *
 * ```js
 * import { createRemarkConfig } from '@mui/internal-code-infra/remark';
 * export default createRemarkConfig();
 * ```
 *
 * Pass `overrides` to scope rule changes to a glob. Each entry's `rules` map
 * is keyed by the rule name (the key used in `RULES`); `false` disables the
 * rule for matching files, a settings tuple replaces its severity/options:
 *
 * ```js
 * createRemarkConfig({
 *   overrides: [
 *     { files: 'docs/special/**', rules: { 'mui-no-space-in-links': false } },
 *     { files: '**\/CHANGELOG.md', rules: { 'heading-style': ['warn', 'atx'] } },
 *   ],
 * });
 * ```
 *
 * @param {Object} [options]
 * @param {Array<{ files: string | string[], rules: Record<string, false | unknown[]> }>} [options.overrides]
 */
export function createRemarkConfig({ overrides = [] } = {}) {
  for (const override of overrides) {
    const unknown = Object.keys(override.rules).filter((ruleName) => !(ruleName in RULES));
    if (unknown.length > 0) {
      throw new Error(`Unknown remark-lint rule name(s): ${unknown.join(', ')}`);
    }
  }

  const entries = Object.entries(RULES).map(([name, entry]) => {
    const [plugin, baseSettings] = /** @type {[import('unified').Plugin<any[], any, any>, any]} */ (
      entry
    );
    const overrideEntries = overrides
      .filter((override) => name in override.rules)
      .map((override) => ({ files: override.files, settings: override.rules[name] }));
    if (overrideEntries.length === 0) {
      return [plugin, baseSettings];
    }
    return [withOverrides(name, plugin, baseSettings, overrideEntries)];
  });

  return {
    settings: {
      bullet: '-',
      emphasis: '_',
      fence: '`',
      listItemIndent: 'one',
      resourceLink: true,
      rule: '-',
    },
    plugins: [[remarkFrontmatter, ['yaml', 'toml']], remarkGfm, remarkLint, ...entries],
  };
}
