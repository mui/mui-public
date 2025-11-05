import { describe, it, expect, vi } from 'vitest';
import type { Configuration as WebpackConfig } from 'webpack';
import type { NextConfig } from 'next';
import { withDocsInfra, getDocsInfraMdxOptions } from './withDocsInfra';

type WebpackConfigContext = Parameters<NonNullable<NextConfig['webpack']>>[1];

describe('withDocsInfra', () => {
  describe('basic configuration', () => {
    it('should add default page extensions', () => {
      const plugin = withDocsInfra();
      const result = plugin({});

      expect(result.pageExtensions).toEqual(['js', 'jsx', 'md', 'mdx', 'ts', 'tsx']);
    });

    it('should enable export output by default', () => {
      const plugin = withDocsInfra();
      const result = plugin({});

      expect(result.output).toBe('export');
    });

    it('should allow disabling export output', () => {
      const plugin = withDocsInfra({ enableExportOutput: false });
      const result = plugin({});

      expect(result.output).toBeUndefined();
    });

    it('should add additional page extensions', () => {
      const plugin = withDocsInfra({ additionalPageExtensions: ['vue', 'svelte'] });
      const result = plugin({});

      expect(result.pageExtensions).toEqual([
        'js',
        'jsx',
        'md',
        'mdx',
        'ts',
        'tsx',
        'vue',
        'svelte',
      ]);
    });

    it('should preserve existing configuration', () => {
      const plugin = withDocsInfra();
      const existingConfig: NextConfig = {
        env: { CUSTOM_VAR: 'value' },
        experimental: { allowDevelopmentBuild: true },
      };
      const result = plugin(existingConfig);

      expect(result.env).toEqual({ CUSTOM_VAR: 'value' });
      expect(result.experimental).toEqual({ allowDevelopmentBuild: true });
    });
  });

  describe('turbopack configuration', () => {
    it('should add default demo patterns to turbopack rules', () => {
      const plugin = withDocsInfra();
      const result = plugin({});

      expect(result.turbopack?.rules).toEqual({
        './app/**/demos/*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: {}, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: {} },
            },
          ],
        },
      });
    });

    it('should add additional demo patterns to turbopack rules', () => {
      const plugin = withDocsInfra({
        additionalDemoPatterns: {
          index: ['./app/**/demos/*/demo-*/index.ts'],
          client: ['./app/**/demos/*/demo-*/client.ts'],
        },
      });
      const result = plugin({});

      expect(result.turbopack?.rules).toEqual({
        './app/**/demos/*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: {}, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: {} },
            },
          ],
        },
        './app/**/demos/*/demo-*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: {}, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/demo-*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: {} },
            },
          ],
        },
      });
    });

    it('should merge with additional turbopack rules', () => {
      const plugin = withDocsInfra({
        additionalTurbopackRules: {
          './custom/**/*.ts': {
            loaders: ['custom-loader'],
          },
        },
      });
      const result = plugin({});

      expect(result.turbopack?.rules).toEqual({
        './app/**/demos/*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: {}, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: {} },
            },
          ],
        },
        './custom/**/*.ts': {
          loaders: ['custom-loader'],
        },
      });
    });

    it('should preserve existing turbopack rules', () => {
      const plugin = withDocsInfra();
      const existingConfig: NextConfig = {
        turbopack: {
          rules: {
            './existing/**/*.ts': {
              loaders: ['existing-loader'],
            },
          },
        },
      };
      const result = plugin(existingConfig);

      expect(result.turbopack?.rules).toEqual({
        './existing/**/*.ts': {
          loaders: ['existing-loader'],
        },
        './app/**/demos/*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: {}, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: {} },
            },
          ],
        },
      });
    });
  });

  describe('webpack configuration', () => {
    const mockDefaultLoaders = {
      babel: {
        test: /\.(js|jsx|ts|tsx)$/,
        use: 'babel-loader',
      },
    };

    const mockWebpackOptions = {
      buildId: 'test-build',
      dev: false,
      isServer: false,
      config: {},
      defaultLoaders: mockDefaultLoaders,
      dir: '/tmp',
      totalPages: 10,
    } as unknown as WebpackConfigContext;

    it('should add default webpack rules for demo patterns', () => {
      const plugin = withDocsInfra();
      const result = plugin({});

      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [],
        },
      };

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      expect(webpackResult.module?.rules).toHaveLength(2);
      expect(webpackResult.module?.rules).toContainEqual({
        test: new RegExp('/demos/[^/]+/index\\.ts$'),
        use: [
          mockDefaultLoaders.babel,
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
            options: { performance: {}, output: 'hastGzip' },
          },
        ],
      });
      expect(webpackResult.module?.rules).toContainEqual({
        test: new RegExp('/demos/[^/]+/client\\.ts$'),
        use: [
          mockDefaultLoaders.babel,
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
            options: { performance: {} },
          },
        ],
      });
    });

    it('should add webpack rules for additional demo patterns', () => {
      const plugin = withDocsInfra({
        additionalDemoPatterns: {
          index: ['./app/**/demos/*/demo-*/index.ts'],
          client: ['./app/**/demos/*/demo-*/client.ts'],
        },
      });
      const result = plugin({});

      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [],
        },
      };

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      // Should have 2 default rules + 2 additional rules = 4 total
      expect(webpackResult.module?.rules).toHaveLength(4);

      // Check for demo-* patterns - look for converted regex patterns
      const demoIndexRule = webpackResult.module?.rules?.find((rule: any) => {
        const source = rule.test?.source || rule.test?.toString();
        return source && source.includes('demo-') && source.includes('index');
      });
      const demoClientRule = webpackResult.module?.rules?.find((rule: any) => {
        const source = rule.test?.source || rule.test?.toString();
        return source && source.includes('demo-') && source.includes('client');
      });

      expect(demoIndexRule).toBeDefined();
      expect(demoClientRule).toBeDefined();
    });

    it('should handle webpack config without module', () => {
      const plugin = withDocsInfra();
      const result = plugin({});

      const mockWebpackConfig: WebpackConfig = {};

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      expect(webpackResult.module).toBeDefined();
      expect(webpackResult.module?.rules).toBeDefined();
      expect(webpackResult.module?.rules).toHaveLength(2);
    });

    it('should call existing webpack function if provided', () => {
      const existingWebpackFn = vi.fn((config) => ({ ...config, custom: true }) as any);
      const plugin = withDocsInfra();
      const result = plugin({
        webpack: existingWebpackFn,
      });

      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [],
        },
      };

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      expect(existingWebpackFn).toHaveBeenCalledWith(mockWebpackConfig, mockWebpackOptions);
      expect((webpackResult as any).custom).toBe(true);
    });

    it('should preserve existing webpack rules', () => {
      const plugin = withDocsInfra();
      const result = plugin({});

      const existingRule = {
        test: /\.css$/,
        use: 'css-loader',
      };

      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [existingRule],
        },
      };

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      expect(webpackResult.module?.rules).toContain(existingRule);
      expect(webpackResult.module?.rules).toHaveLength(3); // 1 existing + 2 new
    });
  });

  describe('pattern conversion', () => {
    it('should convert glob patterns to webpack regex correctly', () => {
      const plugin = withDocsInfra({
        additionalDemoPatterns: {
          index: ['./app/**/demos/*/demo-*/index.ts'],
        },
      });
      const result = plugin({});

      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [],
        },
      };

      const mockWebpackOptions = {
        buildId: 'test-build',
        dev: false,
        isServer: false,
        config: {},
        defaultLoaders: {
          babel: {
            test: /\.(js|jsx|ts|tsx)$/,
            use: 'babel-loader',
          },
        },
      } as unknown as WebpackConfigContext;

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      const demoRule = webpackResult.module?.rules?.find((rule: any) => {
        const source = rule.test?.source || rule.test?.toString();
        return source && source.includes('demo-') && source.includes('index');
      }) as any;

      expect(demoRule).toBeDefined();

      // Test that the regex works correctly for the expected patterns
      const testPaths = [
        '/app/components/demos/Button/demo-variant/index.ts',
        '/app/docs/demos/forms/demo-validation/index.ts',
        '/app/demos/simple/demo-basic/index.ts',
      ];

      const wrongPaths = [
        '/app/components/demos/Button/index.ts', // Missing demo-*
        '/app/components/demos/Button/demo-variant/client.ts', // Wrong file type
        '/app/components/demos/Button/demo-variant/index.js', // Wrong extension
      ];

      testPaths.forEach((path) => {
        expect(demoRule.test.test(path)).toBe(true);
      });

      wrongPaths.forEach((path) => {
        expect(demoRule.test.test(path)).toBe(false);
      });
    });
  });

  describe('equivalent to original configuration', () => {
    it('should produce equivalent output to the original next.config.mjs structure', () => {
      // Test the configuration that matches the original next.config.mjs
      const plugin = withDocsInfra({
        additionalDemoPatterns: {
          index: ['./app/**/demos/*/demo-*/index.ts'],
          client: ['./app/**/demos/*/demo-*/client.ts'],
        },
      });
      const result = plugin({});

      // Check turbopack rules match original
      expect(result.turbopack?.rules).toEqual({
        './app/**/demos/*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: {}, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: {} },
            },
          ],
        },
        './app/**/demos/*/demo-*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: {}, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/demo-*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: {} },
            },
          ],
        },
      });

      // Test webpack function produces equivalent rules
      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [],
        },
      };

      const mockWebpackOptions = {
        buildId: 'test-build',
        dev: false,
        isServer: false,
        config: {},
        defaultLoaders: {
          babel: {
            test: /\.(js|jsx|ts|tsx)$/,
            use: 'babel-loader',
          },
        },
      } as unknown as WebpackConfigContext;

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      // Should have 4 rules total: 2 default + 2 additional demo patterns
      expect(webpackResult.module?.rules).toHaveLength(4);

      // Check for the original patterns
      const originalDemoIndexRule = webpackResult.module?.rules?.find((rule: any) => {
        const source = rule.test?.source || rule.test?.toString();
        return source && source.includes('demo-') && source.includes('index');
      });
      const originalDemoClientRule = webpackResult.module?.rules?.find((rule: any) => {
        const source = rule.test?.source || rule.test?.toString();
        return source && source.includes('demo-') && source.includes('client');
      });

      expect(originalDemoIndexRule).toBeDefined();
      expect(originalDemoClientRule).toBeDefined();
    });
  });

  describe('performance options', () => {
    it('should pass performance options to turbopack loaders', () => {
      const performanceOptions = {
        logging: true,
        notableMs: 500,
        showWrapperMeasures: true,
      };

      const plugin = withDocsInfra({ performance: performanceOptions });
      const result = plugin({});

      expect(result.turbopack?.rules).toEqual({
        './app/**/demos/*/index.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance: performanceOptions, output: 'hastGzip' },
            },
          ],
        },
        './app/**/demos/*/client.ts': {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance: performanceOptions },
            },
          ],
        },
      });
    });

    it('should pass performance options to webpack loaders', () => {
      const performanceOptions = {
        logging: true,
        notableMs: 1000,
        showWrapperMeasures: false,
      };

      const plugin = withDocsInfra({ performance: performanceOptions });
      const result = plugin({});

      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [],
        },
      };

      const mockWebpackOptions = {
        buildId: 'test-build',
        dev: false,
        isServer: false,
        config: {},
        defaultLoaders: {
          babel: {
            test: /\.(js|jsx|ts|tsx)$/,
            use: 'babel-loader',
          },
        },
      };

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      expect(webpackResult.module?.rules).toContainEqual({
        test: new RegExp('/demos/[^/]+/index\\.ts$'),
        use: [
          mockWebpackOptions.defaultLoaders.babel,
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
            options: { performance: performanceOptions, output: 'hastGzip' },
          },
        ],
      });

      expect(webpackResult.module?.rules).toContainEqual({
        test: new RegExp('/demos/[^/]+/client\\.ts$'),
        use: [
          mockWebpackOptions.defaultLoaders.babel,
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
            options: { performance: performanceOptions },
          },
        ],
      });
    });

    it('should pass performance options to additional demo patterns', () => {
      const performanceOptions = {
        logging: false,
        notableMs: 200,
      };

      const plugin = withDocsInfra({
        performance: performanceOptions,
        additionalDemoPatterns: {
          index: ['./app/**/demos/*/demo-*/index.ts'],
          client: ['./app/**/demos/*/demo-*/client.ts'],
        },
      });
      const result = plugin({});

      // Check turbopack rules include performance options
      expect(result.turbopack?.rules?.['./app/**/demos/*/demo-*/index.ts']).toEqual({
        loaders: [
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
            options: { performance: performanceOptions, output: 'hastGzip' },
          },
        ],
      });

      expect(result.turbopack?.rules?.['./app/**/demos/*/demo-*/client.ts']).toEqual({
        loaders: [
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
            options: { performance: performanceOptions },
          },
        ],
      });

      // Check webpack rules include performance options
      const mockWebpackConfig: WebpackConfig = {
        module: {
          rules: [],
        },
      };

      const mockWebpackOptions = {
        buildId: 'test-build',
        dev: false,
        isServer: false,
        config: {},
        defaultLoaders: {
          babel: {
            test: /\.(js|jsx|ts|tsx)$/,
            use: 'babel-loader',
          },
        },
      };

      const webpackResult = result.webpack!(mockWebpackConfig, mockWebpackOptions);

      // Should have 4 rules total: 2 default + 2 additional demo patterns
      expect(webpackResult.module?.rules).toHaveLength(4);

      // Check that additional patterns have performance options
      const additionalIndexRule = webpackResult.module?.rules?.find((rule: any) => {
        const source = rule.test?.source || rule.test?.toString();
        return source && source.includes('demo-') && source.includes('index');
      }) as any;

      const additionalClientRule = webpackResult.module?.rules?.find((rule: any) => {
        const source = rule.test?.source || rule.test?.toString();
        return source && source.includes('demo-') && source.includes('client');
      }) as any;

      expect(additionalIndexRule?.use[1]?.options).toEqual({
        performance: performanceOptions,
        output: 'hastGzip',
      });
      expect(additionalClientRule?.use[1]?.options).toEqual({ performance: performanceOptions });
    });

    it('should handle undefined performance options gracefully', () => {
      const plugin = withDocsInfra(); // No performance options provided
      const result = plugin({});

      expect(result.turbopack?.rules?.['./app/**/demos/*/index.ts']).toEqual({
        loaders: [
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
            options: { performance: {}, output: 'hastGzip' },
          },
        ],
      });
    });
  });
});

describe('getDocsInfraMdxOptions', () => {
  it('should return default MDX options when no custom options provided', () => {
    const result = getDocsInfraMdxOptions();

    expect(result.remarkPlugins).toEqual([
      ['remark-gfm'],
      ['@mui/internal-docs-infra/pipeline/transformMarkdownCode'],
    ]);

    expect(result.rehypePlugins).toEqual([
      ['@mui/internal-docs-infra/pipeline/transformHtmlCodePrecomputed'],
    ]);
  });

  it('should add additional plugins to defaults', () => {
    const result = getDocsInfraMdxOptions({
      additionalRemarkPlugins: [['remark-emoji']],
      additionalRehypePlugins: [['rehype-highlight']],
    });

    expect(result.remarkPlugins).toEqual([
      ['remark-gfm'],
      ['@mui/internal-docs-infra/pipeline/transformMarkdownCode'],
      ['remark-emoji'],
    ]);

    expect(result.rehypePlugins).toEqual([
      ['@mui/internal-docs-infra/pipeline/transformHtmlCodePrecomputed'],
      ['rehype-highlight'],
    ]);
  });

  it('should override defaults when explicit plugins provided', () => {
    const customRemarkPlugins: Array<string | [string, ...any[]]> = [
      ['remark-gfm'],
      ['custom-remark-plugin'],
    ];
    const customRehypePlugins: Array<string | [string, ...any[]]> = [['custom-rehype-plugin']];

    const result = getDocsInfraMdxOptions({
      remarkPlugins: customRemarkPlugins,
      rehypePlugins: customRehypePlugins,
    });

    expect(result.remarkPlugins).toEqual(customRemarkPlugins);
    expect(result.rehypePlugins).toEqual(customRehypePlugins);
  });

  it('should handle mixed custom and additional plugins', () => {
    const result = getDocsInfraMdxOptions({
      remarkPlugins: [['custom-remark-plugin']],
      additionalRehypePlugins: [['rehype-highlight']],
    });

    // remarkPlugins should override defaults
    expect(result.remarkPlugins).toEqual([['custom-remark-plugin']]);

    // rehypePlugins should be defaults + additional
    expect(result.rehypePlugins).toEqual([
      ['@mui/internal-docs-infra/pipeline/transformHtmlCodePrecomputed'],
      ['rehype-highlight'],
    ]);
  });
});
