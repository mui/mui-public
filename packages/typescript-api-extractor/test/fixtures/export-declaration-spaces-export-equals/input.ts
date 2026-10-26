// A default import of an `export =` module reads that assignment: the class
// keeps its value through a plain import and loses it through a type-only one.
import Service from './legacy';
import type TypeOnlyService from './legacy';

export { Service, TypeOnlyService };
