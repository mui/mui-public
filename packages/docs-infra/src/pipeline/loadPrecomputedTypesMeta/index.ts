// This is export format a Webpack / Turbopack loader expects

import { loadPrecomputedTypesMeta } from './loadPrecomputedTypesMeta';

export default loadPrecomputedTypesMeta;

// Re-export types for external consumers
export type { TypesMeta } from './loadPrecomputedTypesMeta';
