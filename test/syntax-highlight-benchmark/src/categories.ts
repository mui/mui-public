export const CATEGORIES = [
  'plain',
  'comment',
  'string',
  'keyword',
  'number',
  'constant',
  'function',
  'type',
  'tag',
  'attribute',
  'property',
  'variable',
  'punctuation',
  'markup',
  'inserted',
  'deleted',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Categories every engine names the same way, so their agreement says something
 * about highlighting quality rather than about differing taxonomies.
 */
export const COMPARABLE_CATEGORIES: readonly Category[] = [
  'comment',
  'string',
  'keyword',
  'number',
  'tag',
  'inserted',
  'deleted',
];

export function isNumericText(text: string): boolean {
  const trimmed = text.trim();
  const start = trimmed.startsWith('-') ? 1 : 0;
  const code = trimmed.charCodeAt(start);
  if (code >= 48 && code <= 57) {
    return true;
  }
  const next = trimmed.charCodeAt(start + 1);
  return code === 46 && next >= 48 && next <= 57;
}
