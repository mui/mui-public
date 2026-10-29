// A namespace re-export is recorded with every export of its module. Constants
// and the type helper next to them are told apart by their declaration spaces,
// not by their literal types.
export * as ButtonDataAttributes from './attributes';

// A namespace re-export nested in another one is recorded under its full path,
// and is a member of the outer one. A namespace merged onto an export is a
// member too, with no record of its own.
export * as Toolbar from './toolbar';

// Namespaces in the module are members whether or not they produce exports:
// a type-only re-export and a namespace of types are not values, a namespace
// holding a value is.
export * as Mixed from './mixed';

// Through a type-only site, the namespace and all its members are types only.
export type * as TypeOnly from './toolbar';
