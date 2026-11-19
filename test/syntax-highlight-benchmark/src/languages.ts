export const LANGUAGES = [
  'js',
  'ts',
  'tsx',
  'json',
  'md',
  'mdx',
  'html',
  'css',
  'sh',
  'yaml',
  'diff',
] as const;

export type Language = (typeof LANGUAGES)[number];
