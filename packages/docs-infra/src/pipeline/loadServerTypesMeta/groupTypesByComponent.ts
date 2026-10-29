/** What grouping reads of a formatted type. */
export interface GroupableType {
  /** The export name, e.g. `Accordion.Root.State` */
  name: string;
  /** The kind of the formatted type, e.g. `component` or `raw` */
  type: string;
}

/** The group holding types that belong to no sub-component. */
const DEFAULT_GROUP = 'Default';

/** Kinds that document a sub-component of their own when named `Parent.Child`. */
const SUB_COMPONENT_KINDS = new Set(['component', 'hook', 'function', 'class']);

function isSubComponent(item: GroupableType, typeSuffixes: string[]): boolean {
  const parts = item.name.split('.');
  return (
    parts.length === 2 && SUB_COMPONENT_KINDS.has(item.type) && !typeSuffixes.includes(parts[1])
  );
}

/**
 * Groups an entrypoint's types by the sub-component they document, e.g. `Accordion.Root`
 * and `Accordion.Trigger`:
 *
 * - a 2-part component, hook, function, or class (`Accordion.Root`) is its own group;
 * - a 3+ part name (`Accordion.Root.State`) goes to the group of its first two parts, or,
 *   when those name a raw type such as a constant group (`Toolbar.ButtonDataAttributes`),
 *   to that raw type's group;
 * - anything else (`DirectionProvider`, `Toolbar.Orientation`) stays in `Default`.
 *
 * When no type is a sub-component, such as `Button` with `Button.Props` and
 * `Button.State`, where the second part is one of `typeSuffixes`, everything stays in
 * `Default`.
 *
 * @returns The types in each group, in their original order, keyed by group name
 */
export function groupTypesByComponent<T extends GroupableType>(
  types: T[],
  typeSuffixes: string[],
): Map<string, T[]> {
  if (!types.some((item) => isSubComponent(item, typeSuffixes))) {
    return new Map([[DEFAULT_GROUP, types]]);
  }

  const groupedTypes = new Map<string, T[]>();
  const names = new Set(types.map((item) => item.name));
  const subComponents = new Set(
    types.filter((item) => SUB_COMPONENT_KINDS.has(item.type)).map((item) => item.name),
  );

  for (const item of types) {
    const parts = item.name.split('.');
    let groupName = DEFAULT_GROUP;
    if (parts.length >= 3) {
      const owner = `${parts[0]}.${parts[1]}`;
      // A raw type stays in the default group, and so does anything nested in it.
      groupName = names.has(owner) && !subComponents.has(owner) ? DEFAULT_GROUP : owner;
    } else if (parts.length === 2 && SUB_COMPONENT_KINDS.has(item.type)) {
      groupName = item.name;
    }

    const group = groupedTypes.get(groupName);
    if (group) {
      group.push(item);
    } else {
      groupedTypes.set(groupName, [item]);
    }
  }

  return groupedTypes;
}
