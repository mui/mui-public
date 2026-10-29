// Behind a type-only star export, an export is kept when it can still be used as
// a type. A function merged with an interface two modules back keeps that
// interface, and a namespace holding only types keeps its members.
export type * from './barrel';

// Declarations merged onto a direct re-export add their spaces to the target's.
export { directlyMergedFunction } from './functions';

export interface directlyMergedFunction {
	id: string;
}
