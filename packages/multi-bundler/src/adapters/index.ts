import type { BundlerType } from '../types';
import { BundlerAdapter } from './base';

export async function createBundlerAdapter(bundler: BundlerType): Promise<BundlerAdapter> {
  switch (bundler) {
    case 'tsdown': {
      const { Adapter: TsdownAdapter } = await import('./adapter-tsdown');
      return new TsdownAdapter();
    }
    default:
      throw new Error(`Unsupported bundler: ${bundler}`);
  }
}
