// A type-only star export masks the value space through any number of plain
// star exports behind it. Classes keep their type, while functions, which have
// no type meaning, are dropped.
export type * from './barrel';

// A namespace re-export of a module that itself uses `export type *` carries no
// value for those members, and drops the functions among them.
export * as TypeOnlyBarrelNamespace from './typeOnlyBarrel';

// A plain namespace re-export of a plain barrel keeps the value space.
export * as ValueBarrelNamespace from './barrel';

// A plain star export of a barrel holding named type-only re-exports keeps their
// types, classes included, and masks the value.
export * from './typeReexportBarrel';

// When another plain star export also carries the binding, the value survives,
// whichever star export comes first.
export * from './valueClassBarrel';
