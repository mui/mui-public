import type { Code, InlineCode, Root } from 'mdast';
import { visit } from 'unist-util-visit';

const INLINE_LANGUAGE_SUFFIX = /^([\s\S]+)\{:(\w+)\}$/;
const META_KEY_VALUE = /([A-Za-z][\w-]*)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
const META_FLAG = /^[A-Za-z][\w-]*$/;

export interface TransformMarkdownCodeOptions {
  /** Language assigned to inline code without an explicit `{:language}` suffix. @default 'tsx' */
  defaultInlineCodeLanguage?: string | false;
}

function addLanguageClass(node: Code | InlineCode, language: string): void {
  node.data ??= {};
  node.data.hProperties ??= {};
  const properties = node.data.hProperties as Record<string, unknown>;
  let existing: string[] = [];
  if (Array.isArray(properties.className)) {
    existing = properties.className.filter((value): value is string => typeof value === 'string');
  } else if (typeof properties.className === 'string') {
    existing = [properties.className];
  }
  const languageClass = `language-${language}`;
  properties.className = existing.includes(languageClass) ? existing : [...existing, languageClass];
}

function dataProperty(key: string): string {
  return `data${key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;
}

function addMetadata(node: Code): void {
  if (!node.meta) {
    return;
  }
  node.data ??= {};
  node.data.hProperties ??= {};
  const properties = node.data.hProperties as Record<string, unknown>;
  const consumed: Array<{ start: number; end: number }> = [];
  let match = META_KEY_VALUE.exec(node.meta);
  while (match) {
    const [, key, rawValue] = match;
    const value = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
    properties[dataProperty(key)] = value;
    consumed.push({ start: match.index, end: match.index + match[0].length });
    match = META_KEY_VALUE.exec(node.meta);
  }

  let remaining = node.meta;
  for (const range of consumed.reverse()) {
    remaining = remaining.slice(0, range.start) + remaining.slice(range.end);
  }
  for (const flag of remaining.split(/\s+/)) {
    if (META_FLAG.test(flag)) {
      properties[dataProperty(flag)] = 'true';
    }
  }
}

/** Passes MDX code languages and fence metadata to the lite rehype highlighter. */
export function transformMarkdownCode(options: TransformMarkdownCodeOptions = {}) {
  const defaultInlineCodeLanguage = options.defaultInlineCodeLanguage ?? 'tsx';
  return (tree: Root): void => {
    visit(tree, 'code', (node: Code) => {
      if (node.lang) {
        addLanguageClass(node, node.lang);
      }
      addMetadata(node);
    });

    visit(tree, 'inlineCode', (node: InlineCode) => {
      const explicit = INLINE_LANGUAGE_SUFFIX.exec(node.value);
      if (explicit) {
        node.value = explicit[1];
        addLanguageClass(node, explicit[2]);
      } else if (defaultInlineCodeLanguage !== false) {
        addLanguageClass(node, defaultInlineCodeLanguage);
      }
    });
  };
}

export default transformMarkdownCode;
