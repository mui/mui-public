import { mergedTarget } from './helpers';
import type { typeOnlyImported } from './helpers';

// A type alias and a constant annotated with it resolve to the same literal
// type; only the declaration spaces tell them apart.
export type PlainAlias = 'alias';

export const annotatedConstant: PlainAlias = 'alias';

export const plainConstant = 'constant';

export function plainFunction(): string {
	return 'function';
}

// Expando assignments make the binder set SymbolFlags.Module, but they do not
// declare a namespace.
export function expandoFunction(): string {
	return 'expando';
}
expandoFunction.extra = 'extra';

export class PlainClass {
	id: string = 'class';
}

export enum PlainEnum {
	member = 'member',
}

export interface PlainInterface {
	id: string;
}

// Merged declarations occupy both the value and the type space.
export interface Merged {
	id: string;
}

export const Merged: Merged = { id: 'merged' };

// An imported value merged with a local interface occupies the spaces of both.
interface mergedTarget {
	id: string;
}

export { mergedTarget };

// A namespace containing only types occupies just the namespace space. It is
// exported through a specifier because a directly exported namespace is
// flattened into its members.
namespace TypesNamespace {
	export type Nested = 'nested';
}

export type { TypesNamespace };

// A function merged with a namespace occupies the value and namespace spaces.
export function fnWithNs(): string {
	return 'fn-with-ns';
}

export namespace fnWithNs {
	export type Nested = 'nested';
}

// A type-only export of a merged namespace masks the value space of its
// members too: nothing crosses the export site at runtime.
function nsFn(): string {
	return 'ns-fn';
}

namespace nsFn {
	export const inner = 'inner';
}

export type { nsFn };

// A value re-exported through a type-only import has no runtime binding,
// even though the export specifier itself is not type-only.
export { typeOnlyImported };

// Type-only re-exports never occupy the value space, whatever their target is.
export type { ReexportedAlias, ReexportedClass } from './helpers';

export { reexportedValue } from './helpers';

// An enum survives a type-only star export as a type, not as a value.
export type * from './enums';

// Reaching the same module both ways keeps the value space: the plain star export
// carries the runtime binding regardless of the type-only one.
export * from './dual-enums';
export type * from './dual-enums';

// A type-only namespace re-export masks the value space of its members too,
// like every other type-only export site.
export type * as TypeOnlyNamespace from './helpers';

// The same re-export without `type` keeps the value space.
export * as ValueNamespace from './helpers';

// A default-exported class occupies the value and type spaces like any class.
export default class DefaultClass {
	id: string = 'default';
}
