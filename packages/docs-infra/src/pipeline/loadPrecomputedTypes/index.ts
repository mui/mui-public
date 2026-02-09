// This is export format a Webpack / Turbopack loader expects

import { loadPrecomputedTypes } from './loadPrecomputedTypes';

export default loadPrecomputedTypes;

// Re-export types for external consumers
export type { TypesMeta } from './loadPrecomputedTypes';
