import * as api from './functions';
import { chainedFunction } from './merged';
import type { MergedConstant } from './types';

// A merged alias re-exported from another module keeps the spaces merged onto
// it there: the function value and the interface type.
export { mergedFunction } from './merged';

// A second merge along the chain adds the namespace space without losing the
// function value or the interface merged onto it one module earlier.
namespace chainedFunction {
	export type Nested = 'nested';
}

export { chainedFunction };

// A local value merged with a type-only import keeps its value: only the
// imported interface is type-only.
const MergedConstant = { id: 'merged-constant' };

export { MergedConstant };

// A re-exported namespace import is a namespace, and its module object is a value.
export { api };
