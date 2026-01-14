import { builtinModules } from 'node:module';
import { generateBanner } from '../utils/config-finder.mjs';

/**
 * @typedef {import('../types.mjs').BundlerConfig} BundlerConfig
 * @typedef {import('../types.mjs').BundlerType} BundlerType
 * @typedef {import('../types.mjs').OutputChunk} OutputChunk
 */

/**
 * @typedef {Object} BundlerAdapter
 * @property {BundlerType} name - The name of the bundler
 * @property {(config: BundlerConfig) => Promise<OutputChunk[]>} build - Build the bundle and return the generated exports field
 */

/**
 * Base bundler adapter class
 * @abstract
 * @implements {BundlerAdapter}
 */
export class BaseBundlerAdapter {
  /** @type {BundlerType} */
  name = 'rollup';

  /**
   * @abstract
   * @param {BundlerConfig} _config
   * @returns {Promise<OutputChunk[]>}
   */
  async build(_config) {
    throw new Error('Not implemented');
  }

  /**
   * @protected
   * @param {BundlerConfig} config
   * @returns {string[]}
   */
  getExternalDependencies(config) {
    const deps = new Set(
      Array.from([
        ...Object.keys(config.packageInfo.peerDependencies ?? {}),
        ...Object.keys(config.packageInfo.dependencies ?? {}),
        ...builtinModules,
      ]),
    );
    return Array.from(deps);
  }

  /**
   * @protected
   * @param {BundlerConfig} config
   * @returns {string}
   */
  getBanner(config) {
    return generateBanner(config.packageInfo);
  }
}
