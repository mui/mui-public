import { chainedFunction, mergedFunction } from './functions';

// Each import is merged with a local interface, so it occupies both spaces.
interface mergedFunction {
	id: string;
}

interface chainedFunction {
	id: string;
}

export { chainedFunction, mergedFunction };
