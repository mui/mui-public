import type { Element } from 'hast';
import {
  getShallowTextContent,
  hasClass,
  isConstantSpan,
  isEntityNameSpan,
  isKeywordSpan as isKeywordSpanShared,
  isPropertyNameSpan,
} from '../loadServerTypes/hastTypeUtils';
import { toKebabCase } from '../loaderUtils/toKebabCase';
import type { LanguageCapabilities } from './getLanguageCapabilities';

/**
 * Converts a prop path (array of property names) to a kebab-case dotted string.
 * Each segment is independently converted.
 * Example: ["homeAddress", "streetName"] → "home-address.street-name"
 */
export function propPathToString(propPath: string[], propName: string): string {
  const allParts = [...propPath, propName];
  return allParts.map(toKebabCase).join('.');
}

/**
 * Checks if an element is a linkable span (pl-c1 or pl-en).
 * In CSS contexts, pl-v (CSS variables) and pl-e (class selectors) are also linkable.
 * Only spans are considered linkable - not anchors we've already created.
 */
export function isLinkableSpan(element: Element, lang?: LanguageCapabilities): boolean {
  if (isConstantSpan(element) || isEntityNameSpan(element)) {
    return true;
  }
  if (lang?.semantics === 'css') {
    return isPropertyNameSpan(element) || (element.tagName === 'span' && hasClass(element, 'pl-e'));
  }
  return false;
}

/**
 * Checks if an element is a property span (pl-v or pl-e).
 */
export function isPropertySpan(element: Element): boolean {
  return isPropertyNameSpan(element) || (element.tagName === 'span' && hasClass(element, 'pl-e'));
}

/**
 * Checks if an element is a keyword span (pl-k).
 */
export function isKeywordSpan(element: Element): boolean {
  return isKeywordSpanShared(element);
}

/**
 * Checks if an element is an identifier reference span (pl-smi).
 */
export function isSmiSpan(element: Element): boolean {
  return element.tagName === 'span' && hasClass(element, 'pl-smi');
}

/**
 * Gets the text content of an element (concatenates all text children).
 */
export function getTextContent(element: Element): string {
  return getShallowTextContent(element);
}

/**
 * Gets the class names from an element's properties.
 */
export function getClassName(element: Element): string[] | undefined {
  const className = element.properties?.className;
  return Array.isArray(className) ? (className as string[]) : undefined;
}
