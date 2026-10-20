import 'server-only';
import { MDN_TYPE_LINKS } from './mdnTypeLinks';

/**
 * Returns the MDN page for a global type, such as `HTMLElement` or `Intl.LocalesArgument`,
 * or `null` when MDN does not document it.
 *
 * Types that only exist in TypeScript's lib files link to the section of the parameter
 * they describe, so `Intl.NumberFormatOptions` links to the `options` parameter of the
 * `Intl.NumberFormat()` constructor.
 *
 * Matching is by name, so a type from a package that shares its name with a built-in
 * type also resolves to the built-in type's page.
 *
 * @param name - Type name as written in code, including namespaces, such as `Intl.NumberFormat`.
 * @returns The MDN URL, or `null` when MDN does not document the type.
 */
export function resolveServerMdnLink(name: string): string | null {
  return Object.hasOwn(MDN_TYPE_LINKS, name) ? MDN_TYPE_LINKS[name] : null;
}
