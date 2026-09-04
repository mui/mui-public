import type { Externals, LoadSource } from '../../CodeHighlighter/types';
import type { DemoEntry } from '../precomputeDemo';

export interface GenerateDemoExternalsModuleOptions {
  /** Source entries whose external imports should be collected. */
  entries: DemoEntry[];
  /** Names already declared in the destination module. */
  existingNames?: string[];
  /** Source loader. Defaults to the local filesystem loader. */
  loadSource?: LoadSource;
  /** Maximum relative-import depth. */
  maxDepth?: number;
}

export interface GeneratedExternalsModule {
  /** Static import statements for the runtime dependencies. */
  imports: string[];
  /** JavaScript expression containing resolved external-module values. */
  valueExpression: string;
  /** Runtime external imports collected from the source graph. */
  externals: Externals;
  /** Unique source URLs used by the demo. */
  dependencies: string[];
}
