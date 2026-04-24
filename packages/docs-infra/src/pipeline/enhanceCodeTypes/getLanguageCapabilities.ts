import type { Element } from 'hast';
import { getClassName } from './hastUtils';
import type { LanguageCapabilities } from '../parseSource/languageCapabilities';

export type { LanguageCapabilities };

const BASE_CAPABILITIES: LanguageCapabilities = {
  supportsTypes: false,
  supportsJsx: false,
};

/**
 * Detects language capabilities from a `<code>` element's class list.
 * Looks for a `language-*` class following standard markdown fenced-code conventions.
 */
export function getLanguageCapabilities(node: Element): LanguageCapabilities {
  const classes = getClassName(node);
  if (!classes) {
    return BASE_CAPABILITIES;
  }

  const langClass = classes.find((c) => c.startsWith('language-'));
  if (!langClass) {
    return BASE_CAPABILITIES;
  }

  const lang = langClass.slice('language-'.length).toLowerCase();
  switch (lang) {
    case 'js':
    case 'javascript':
      return {
        supportsTypes: false,
        supportsJsx: false,
        semantics: 'js',
      };
    case 'jsx':
      return {
        supportsTypes: false,
        supportsJsx: true,
        semantics: 'js',
      };
    case 'ts':
    case 'typescript':
      return {
        supportsTypes: true,
        supportsJsx: false,
        semantics: 'js',
      };
    case 'tsx':
      return {
        supportsTypes: true,
        supportsJsx: true,
        semantics: 'js',
      };
    case 'css':
    case 'scss':
    case 'less':
    case 'sass':
      return {
        supportsTypes: false,
        supportsJsx: false,
        semantics: 'css',
      };
    default:
      return BASE_CAPABILITIES;
  }
}
