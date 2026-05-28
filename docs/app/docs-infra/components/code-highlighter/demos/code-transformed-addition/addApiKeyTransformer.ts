import type { SourceTransformer } from '@mui/internal-docs-infra/CodeHighlighter/types';

/**
 * Demo transformer that prepends a randomly generated API key constant
 * to the source. The added lines are flagged with `@expanding` markers
 * in the returned comments map so the runtime applies
 * `data-expanding=""` to them and animates their height during the
 * swap window.
 *
 * Transformer-returned comments are 0-indexed (matching
 * `source.split('\n')`); the pipeline converts them to the 1-indexed
 * scheme the rest of the runtime uses.
 */
export const AddApiKeyTransformer: SourceTransformer = {
  extensions: ['ts', 'tsx', 'js', 'jsx'],
  transformer: async (source, fileName) => {
    const apiKey = Math.random().toString(36).slice(2, 14);
    const prefix = `const API_KEY = '${apiKey}';\n\n`;
    const transformed = prefix + source;

    // 0-indexed line 0 = the `const API_KEY = '...';` line,
    // 0-indexed line 1 = the blank separator line. Mark both as
    // single-line additions so each one animates independently — no
    // need to bracket them with a range when every entry is its own
    // added line.
    const comments = {
      0: ['@expanding'],
      1: ['@expanding'],
    };

    return {
      withKey: { source: transformed, fileName, comments },
    };
  },
};
