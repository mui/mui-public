import type { BundlerType } from '../types';
import { BundlerAdapter } from './base';

export async function createBundlerAdapter(bundler: BundlerType): Promise<BundlerAdapter> {
  switch (bundler) {
    case 'tsdown': {
      const { Adapter: TsdownAdapter } = await import('./adapter-tsdown');
      return new TsdownAdapter();
    }
    case 'rollup': {
      const { Adapter: RollupAdapter } = await import('./adapter-rollup');
      return new RollupAdapter();
    }
    default:
      throw new Error(`Unsupported bundler: ${bundler}`);
  }
}
