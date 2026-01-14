/**
 * @typedef {import('../types.mjs').BundlerType} BundlerType
 * @typedef {import('./base.mjs').BundlerAdapter} BundlerAdapter
 */

/**
 * @param {BundlerType} bundler
 * @returns {Promise<BundlerAdapter>}
 */
export async function createBundlerAdapter(bundler) {
  switch (bundler) {
    case 'rollup': {
      const { Adapter: RollupAdapter } = await import('./adapter-rollup.mjs');
      return new RollupAdapter();
    }
    default:
      throw new Error(`Unsupported bundler: ${bundler}`);
  }
}
