/**
 * The namespace a page's section slugs leave out: the first segment of its first dotted type
 * name, such as `Accordion` for `Accordion.Root`.
 */
export function findComponentPrefix(names: Iterable<string>): string {
  for (const name of names) {
    if (name.includes('.')) {
      return name.split('.')[0];
    }
  }
  return '';
}

/**
 * The slug of a type's section: its name lowercased, without the page's component namespace
 * (`root.props` for `Accordion.Root.Props` on the Accordion page).
 */
export function computeTypeSlug(name: string, componentPrefix: string): string {
  const parts = name.split('.');
  if (parts.length > 1 && parts[0] === componentPrefix) {
    return parts.slice(1).join('.').toLowerCase();
  }
  return name.toLowerCase();
}
