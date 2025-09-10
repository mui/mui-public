import type { Configuration as WebpackConfig, RuleSetRule } from 'webpack';

// Define minimal NextConfig type to avoid importing from 'next'
export interface NextConfig {
  pageExtensions?: string[];
  output?: 'export' | 'standalone' | undefined;
  turbopack?: {
    rules?: Record<
      string,
      { loaders: Array<string | { loader: string; options: Record<string, unknown> }> }
    >;
  };
  webpack?: (config: WebpackConfig, options: WebpackOptions) => WebpackConfig;
  [key: string]: any;
}

// Define webpack options interface based on Next.js webpack function signature
export interface WebpackOptions {
  buildId: string;
  dev: boolean;
  isServer: boolean;
  nextRuntime?: 'nodejs' | 'edge';
  config: NextConfig;
  defaultLoaders: {
    babel: RuleSetRule;
  };
}

export interface WithDocsInfraOptions {
  /**
   * Additional page extensions to support beyond the default docs-infra extensions.
   * Default docs-infra extensions are: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx']
   */
  additionalPageExtensions?: string[];
  /**
   * Whether to enable the export output mode.
   * @default true
   */
  enableExportOutput?: boolean;
  /**
   * Custom demo path pattern for loader rules.
   * @default './app/ ** /demos/ * /index.ts'
   */
  demoPathPattern?: string;
  /**
   * Custom client demo path pattern for loader rules.
   * @default './app/ ** /demos/ * /client.ts'
   */
  clientDemoPathPattern?: string;
  /**
   * Additional demo loader patterns for both Turbopack and Webpack.
   * Each pattern will use the appropriate code highlighter loaders.
   */
  additionalDemoPatterns?: {
    /** Patterns for index files that should use loadPrecomputedCodeHighlighter */
    index?: string[];
    /** Patterns for client files that should use loadPrecomputedCodeHighlighterClient */
    client?: string[];
  };
  /**
   * Additional Turbopack rules to merge with the default docs-infra rules.
   */
  additionalTurbopackRules?: Record<string, { loaders: string[] }>;
  /**
   * Performance logging options
   */
  performance?: {
    logging: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
  };
}

export interface DocsInfraMdxOptions {
  remarkPlugins?: Array<string | [string, ...any[]]>;
  rehypePlugins?: Array<string | [string, ...any[]]>;
  /**
   * Additional remark plugins to add to the default docs-infra plugins
   */
  additionalRemarkPlugins?: Array<string | [string, ...any[]]>;
  /**
   * Additional rehype plugins to add to the default docs-infra plugins
   */
  additionalRehypePlugins?: Array<string | [string, ...any[]]>;
}

/**
 * Get default MDX options for docs-infra
 */
export function getDocsInfraMdxOptions(
  customOptions: DocsInfraMdxOptions = {},
): DocsInfraMdxOptions {
  const defaultRemarkPlugins: Array<string | [string, ...any[]]> = [
    ['remark-gfm'],
    ['@mui/internal-docs-infra/pipeline/transformMarkdownRelativePaths'],
    ['@mui/internal-docs-infra/pipeline/transformMarkdownBlockquoteCallouts'],
    ['@mui/internal-docs-infra/pipeline/transformMarkdownCode'],
    ['@mui/internal-docs-infra/pipeline/transformMarkdownDemoLinks'],
  ];

  const defaultRehypePlugins: Array<string | [string, ...any[]]> = [
    ['@mui/internal-docs-infra/pipeline/transformHtmlCode'],
  ];

  // Build final plugin arrays
  const remarkPlugins = customOptions.remarkPlugins ?? [
    ...defaultRemarkPlugins,
    ...(customOptions.additionalRemarkPlugins ?? []),
  ];

  const rehypePlugins = customOptions.rehypePlugins ?? [
    ...defaultRehypePlugins,
    ...(customOptions.additionalRehypePlugins ?? []),
  ];

  return {
    remarkPlugins,
    rehypePlugins,
  };
}

/**
 * Next.js plugin for MUI docs infrastructure.
 * Configures webpack loaders, turbopack rules for docs sites.
 * Use getDocsInfraMdxOptions() with createMDX for MDX integration.
 */
export function withDocsInfra(options: WithDocsInfraOptions = {}) {
  const {
    additionalPageExtensions = [],
    enableExportOutput = true,
    demoPathPattern = './app/**/demos/*/index.ts',
    clientDemoPathPattern = './app/**/demos/*/client.ts',
    additionalDemoPatterns = {},
    additionalTurbopackRules = {},
    performance,
  } = options;

  return (nextConfig: NextConfig = {}): NextConfig => {
    const basePageExtensions = ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'];
    const pageExtensions = [...basePageExtensions, ...additionalPageExtensions];

    // Build Turbopack rules
    const turbopackRules: Record<
      string,
      { loaders: { loader: string; options: Record<string, unknown> }[] }
    > = {
      [demoPathPattern]: {
        loaders: [
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
            options: { performance },
          },
        ],
      },
      [clientDemoPathPattern]: {
        loaders: [
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
            options: { performance },
          },
        ],
      },
      './app/**/types.ts': {
        loaders: [
          {
            loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedTypesMeta',
            options: { performance },
          },
        ],
      },
    };

    // Add additional demo patterns to Turbopack rules
    if (additionalDemoPatterns.index) {
      additionalDemoPatterns.index.forEach((pattern) => {
        turbopackRules[pattern] = {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance },
            },
          ],
        };
      });
    }

    if (additionalDemoPatterns.client) {
      additionalDemoPatterns.client.forEach((pattern) => {
        turbopackRules[pattern] = {
          loaders: [
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance },
            },
          ],
        };
      });
    }

    // Merge with additional turbopack rules
    Object.assign(turbopackRules, additionalTurbopackRules);

    const config: NextConfig = {
      ...nextConfig,
      pageExtensions,
      ...(enableExportOutput && { output: 'export' }),
      turbopack: {
        ...nextConfig.turbopack,
        rules: {
          ...nextConfig.turbopack?.rules,
          ...turbopackRules,
        },
      },
      webpack: (webpackConfig: WebpackConfig, webpackOptions: WebpackOptions) => {
        // Call existing webpack function if it exists
        if (nextConfig.webpack) {
          webpackConfig = nextConfig.webpack(webpackConfig, webpackOptions);
        }

        // Ensure module and rules exist
        if (!webpackConfig.module) {
          webpackConfig.module = {};
        }
        if (!webpackConfig.module.rules) {
          webpackConfig.module.rules = [];
        }

        const { defaultLoaders } = webpackOptions;

        // Add loader for demo index files
        webpackConfig.module.rules.push({
          test: new RegExp('/demos/[^/]+/index\\.ts$'),
          use: [
            defaultLoaders.babel,
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
              options: { performance },
            },
          ],
        });

        // Client files for live demos - processes externals
        webpackConfig.module.rules.push({
          test: new RegExp('/demos/[^/]+/client\\.ts$'),
          use: [
            defaultLoaders.babel,
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
              options: { performance },
            },
          ],
        });

        // Types files for type metadata
        webpackConfig.module.rules.push({
          test: new RegExp('/types\\.ts$'),
          use: [
            defaultLoaders.babel,
            {
              loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedTypesMeta',
              options: { performance },
            },
          ],
        });

        // Add webpack rules for additional demo patterns
        if (additionalDemoPatterns.index) {
          additionalDemoPatterns.index.forEach((pattern) => {
            // Convert Turbopack pattern to webpack regex
            const regexPattern = pattern
              .replace(/^\.\//, '/') // Remove leading ./
              .replace(/\*\*\//g, 'DOUBLE_STAR_PLACEHOLDER') // Replace **/ with placeholder
              .replace(/\*/g, '[^/]+') // Replace single * with single dir pattern
              .replace(/\./g, '\\.') // Escape dots
              .replace(/DOUBLE_STAR_PLACEHOLDER/g, '(?:[^/]+/)*'); // Replace placeholder with zero or more directories

            webpackConfig.module!.rules!.push({
              test: new RegExp(`${regexPattern}$`),
              use: [
                defaultLoaders.babel,
                {
                  loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighter',
                  options: { performance },
                },
              ],
            });
          });
        }

        if (additionalDemoPatterns.client) {
          additionalDemoPatterns.client.forEach((pattern) => {
            // Convert Turbopack pattern to webpack regex
            const regexPattern = pattern
              .replace(/^\.\//, '/') // Remove leading ./
              .replace(/\*\*\//g, 'DOUBLE_STAR_PLACEHOLDER') // Replace **/ with placeholder
              .replace(/\*/g, '[^/]+') // Replace single * with single dir pattern
              .replace(/\./g, '\\.') // Escape dots
              .replace(/DOUBLE_STAR_PLACEHOLDER/g, '(?:[^/]+/)*'); // Replace placeholder with zero or more directories

            webpackConfig.module!.rules!.push({
              test: new RegExp(`${regexPattern}$`),
              use: [
                defaultLoaders.babel,
                {
                  loader: '@mui/internal-docs-infra/pipeline/loadPrecomputedCodeHighlighterClient',
                  options: { performance },
                },
              ],
            });
          });
        }

        return webpackConfig;
      },
    };

    return config;
  };
}
