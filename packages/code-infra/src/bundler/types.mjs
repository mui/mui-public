/**
 * @typedef {'esm' | 'cjs'} Format
 */

/**
 * @typedef {'rollup'} BundlerType
 */

/**
 * @typedef {'node' | 'browser' | 'neutral'} Platform
 */

/**
 * Resolved entry point with metadata
 * @typedef {Object} ResolvedEntry
 * @property {string} exportKey - The export key (e.g., ".", "./adapter-*")
 * @property {string} [condition] - The condition key if nested (e.g., "react-server", "default")
 * @property {string} source - Source file path
 * @property {Platform} platform - Target platform
 * @property {boolean} [isBin] - Whether this is a bin entry
 * @property {string} [binName] - Bin name if this is a bin entry
 * @property {string} originalKey
 */

/**
 * Nested export conditions (e.g., { "types": "...", "default": "..." })
 * @typedef {Object} ExportConditions
 * @property {string} [types]
 * @property {string | { types?: string; default?: string }} [import]
 * @property {string | { types?: string; default?: string }} [require]
 * @property {string | { types?: string; default?: string }} [default]
 * @property {string} [node]
 * @property {string} [browser]
 * @property {string} [react-server]
 * @property {string} [deno]
 * @property {string} [workerd]
 * @property {string} [worker]
 * @property {string} [edge-light]
 */

/**
 * Package.json exports field structure
 * @typedef {string | ExportConditions | Record<string, string | ExportConditions>} ExportsField
 */

/**
 * Package.json bin field structure
 * @typedef {string | Record<string, string>} BinField
 */

/**
 * @typedef {Object} PackageInfo
 * @property {string} name
 * @property {string} version
 * @property {string} [license]
 * @property {ExportsField} [exports]
 * @property {BinField} [bin]
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [peerDependencies]
 * @property {Record<string, string>} [devDependencies]
 * @property {Record<string, { optional: boolean }>} [peerDependenciesMeta]
 * @property {{ directory?: string }} [publishConfig]
 * @property {Record<string, string>} [scripts]
 * @property {boolean | string[]} [sideEffects]
 * @property {'module' | 'commonjs'} [type]
 */

/**
 * @typedef {Object} BundlerConfig
 * @property {Map<string, ResolvedEntry>} entries - Entry points mapped from package.json exports
 * @property {string} outDir - Output directory
 * @property {('esm' | 'cjs')[]} formats - Bundle formats to generate
 * @property {boolean} [sourceMap] - Generate source maps
 * @property {boolean} [watch] - Enable watch mode
 * @property {string} [tsconfigPath] - TypeScript config path if exists
 * @property {string} [babelConfigPath] - Babel config path if exists
 * @property {string} cwd - Working directory
 * @property {PackageInfo} packageInfo - Package information
 * @property {boolean} [bundleCss] - Should bundle css
 * @property {boolean} [verbose]
 * @property {boolean} [preserveDirectory]
 * @property {boolean} [enableReactCompiler]
 * @property {boolean} [clean]
 * @property {boolean} [tsgo]
 */

/**
 * Output chunk from the bundler
 * @typedef {Object} OutputChunk
 * @property {string} name - Name of the output (matches entry key). May end with .d for type definitions
 * @property {string} outputFile - Output file path
 * @property {'esm' | 'cjs'} format - Output format
 */

/**
 * Result of generating exports field
 * @typedef {Object} GeneratedExports
 * @property {Record<string, ExportConditions> | {}} exports
 * @property {BinField} bin
 */

export {};
