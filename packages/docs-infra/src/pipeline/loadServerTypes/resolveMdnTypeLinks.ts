import { MDN_BASE_URL, MDN_TYPE_LINKS } from './mdnTypeLinks';

/**
 * Matches identifiers and dotted chains such as `HTMLElement` or `Intl.LocalesArgument`.
 */
const IDENTIFIER_CHAIN = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;

/**
 * Finds the global types with an MDN page that are mentioned anywhere in `data`
 * (type strings, descriptions, examples) and maps each name to its MDN URL.
 *
 * Only names that appear on the page are returned, so the full table never
 * ends up in the precomputed page data.
 */
export function resolveMdnTypeLinks(data: unknown): Record<string, string> {
  const links: Record<string, string> = {};

  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const [name] of value.matchAll(IDENTIFIER_CHAIN)) {
        if (Object.hasOwn(MDN_TYPE_LINKS, name)) {
          links[name] = `${MDN_BASE_URL}${MDN_TYPE_LINKS[name]}`;
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };

  visit(data);

  return links;
}
