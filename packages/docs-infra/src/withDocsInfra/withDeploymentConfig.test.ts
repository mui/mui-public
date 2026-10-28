import { describe, it, expect, vi } from 'vitest';
import type { NextConfig } from 'next';
import { withDeploymentConfig } from './withDeploymentConfig';

describe('withDeploymentConfig', () => {
  it('enables webpackBuildWorker by default', () => {
    const config: NextConfig = {};
    const result = withDeploymentConfig(config);

    expect(result.experimental?.webpackBuildWorker).toBe(true);
  });

  it('lets consumers override webpackBuildWorker', () => {
    const config: NextConfig = { experimental: { webpackBuildWorker: false } };
    const result = withDeploymentConfig(config);

    expect(result.experimental?.webpackBuildWorker).toBe(false);
  });

  describe('webpack MDX layer patch', () => {
    function createMdxConfig() {
      return {
        module: {
          rules: [
            {
              test: /\.mdx$/,
              use: [
                { loader: 'some/next-swc-loader.js', options: {} },
                { loader: 'other-loader.js', options: {} },
              ],
            },
          ],
        },
      };
    }

    it('assigns the rsc bundle layer to MDX swc loaders on the server', () => {
      const result = withDeploymentConfig<NextConfig>({});
      const config = createMdxConfig();

      result.webpack!(config, { isServer: true } as any);

      expect(config.module.rules[0].use[0].options).toEqual({ bundleLayer: 'rsc' });
      expect(config.module.rules[0].use[1].options).toEqual({});
    });

    it('does not patch on the client', () => {
      const result = withDeploymentConfig<NextConfig>({});
      const config = createMdxConfig();

      result.webpack!(config, { isServer: false } as any);

      expect(config.module.rules[0].use[0].options).toEqual({});
    });

    it('throws when a bundleLayer is already assigned, signaling the workaround is obsolete', () => {
      const result = withDeploymentConfig<NextConfig>({});
      const config = createMdxConfig();
      config.module.rules[0].use[0].options = { bundleLayer: 'rsc' } as any;

      expect(() => result.webpack!(config, { isServer: true } as any)).toThrow(
        /vercel\/next\.js\/issues\/91735/,
      );
    });

    it('delegates to a consumer-supplied webpack config', () => {
      const consumerWebpack = vi.fn((config) => config);
      const result = withDeploymentConfig<NextConfig>({ webpack: consumerWebpack });
      const config = createMdxConfig();
      const context = { isServer: true } as any;

      const returned = result.webpack!(config, context);

      expect(consumerWebpack).toHaveBeenCalledWith(config, context);
      expect(returned).toBe(config);
      expect(config.module.rules[0].use[0].options).toEqual({ bundleLayer: 'rsc' });
    });
  });
});
