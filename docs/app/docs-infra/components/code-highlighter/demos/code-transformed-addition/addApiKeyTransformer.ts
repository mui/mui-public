import type { SourceTransformer } from '@mui/internal-docs-infra/CodeHighlighter/types';

/**
 * Demo transformer that prepends a randomly generated API key constant
 * to the source. The added lines are flagged with `@expanding` markers
 * in the returned comments map so the runtime applies
 * `data-expanding=""` to them and animates their height during the
 * swap window.
 *
 * Comments are 1-indexed everywhere, including the map a transformer returns
 * (keyed against the transformed source's lines).
 */
export const AddApiKeyTransformer: SourceTransformer = {
  extensions: ['ts', 'tsx', 'js', 'jsx'],
  transformer: async (source, fileName) => {
    const apiKey = Math.random().toString(36).slice(2, 14);
    const prefix = `const API_KEY = '${apiKey}';\n\n`;
    const transformed = prefix + source;

    // 1-indexed line 1 = the `const API_KEY = '...';` line,
    // 1-indexed line 2 = the blank separator line. Mark both as
    // single-line additions so each one animates independently — no
    // need to bracket them with a range when every entry is its own
    // added line.
    const comments = {
      1: ['@expanding'],
      2: ['@expanding'],
    };

    return {
      withKey: { source: transformed, fileName, comments },
    };
  },
};
