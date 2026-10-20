import 'server-only';
import type { ExternalTypeSource } from '../enhanceCodeTypes';
import { MDN_TYPE_LINKS } from './mdnTypeLinks';

/**
 * TypeScript lib files whose globals MDN documents: the DOM, JavaScript, and workers.
 */
const MDN_DOCUMENTED_LIBS = ['lib.dom', 'lib.es', 'lib.webworker'];

/**
 * Returns the MDN page for a global type, such as `HTMLElement` or `Intl.LocalesArgument`,
 * or `null` when MDN does not document it.
 *
 * Types that only exist in TypeScript's lib files link to the section of the parameter
 * they describe, so `Intl.NumberFormatOptions` links to the `options` parameter of the
 * `Intl.NumberFormat()` constructor.
 *
 * Without a `source`, matching is by name, so a type from a package that shares its name
 * with a built-in type also resolves to the built-in type's page. With a `source`, only
 * types declared in the DOM, JavaScript, or worker lib files resolve.
 *
 * @param name - Type name as written in code, including namespaces, such as `Intl.NumberFormat`.
 * @param source - Where the type is declared, when known.
 * @returns The MDN URL, or `null` when MDN does not document the type.
 */
export function resolveServerMdnLink(name: string, source?: ExternalTypeSource): string | null {
  if (
    source &&
    (source.kind !== 'lib' ||
      !source.files.some((file) => MDN_DOCUMENTED_LIBS.some((lib) => file.startsWith(lib))))
  ) {
    return null;
  }

  return Object.hasOwn(MDN_TYPE_LINKS, name) ? MDN_TYPE_LINKS[name] : null;
}
